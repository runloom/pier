import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { PIER_SYSTEM_SKILL_PREFIX } from "@shared/contracts/project-skills.ts";
import type { PierDiscoveryChannelId } from "@shared/project-skills-pier-channels.ts";
import i18next from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownSourceEditor } from "@/components/code-editor/markdown-source.tsx";
import { useContentDialogFooter } from "@/components/common/dialogs/use-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  emptyDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { commitSkillsIntent } from "./apply-flow.ts";
import { blankSkillMd, isValidSkillId } from "./blank-md.ts";
import { discardPreparedCandidate } from "./candidate-lifecycle.ts";
import { SkillDetailSection } from "./detail-section.tsx";
import { SkillsDiscoveryChannelEditor } from "./discovery-channel-editor.tsx";
import { skillsErrorMessage } from "./error-copy.ts";
import {
  extractSkillMdDescription,
  replaceSkillMdName,
  skillMdNameMatchesId,
} from "./md-description.ts";

function isImportCandidate(value: unknown): value is { token: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { token?: unknown }).token === "string"
  );
}

async function waitForSkillsIdle(timeoutMs = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = useProjectSkillsStore.getState();
    if (!(state.applyPending || state.planPending || state.writesFrozen)) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  return false;
}

/**
 * Add-skill dialog: nothing is written until the user confirms.
 * Same content-dialog shell as edit (name → discovery → SKILL.md).
 */
export function openSkillsCreateSkillDialog(): Promise<null> {
  function Body({
    close,
    setFooter,
    setOnDismissRequest,
    setTitle,
  }: AppContentDialogRenderProps) {
    const t = useT();
    const projectRef = useProjectSkillsStore((s) => s.projectRef);
    const snapshot = useProjectSkillsStore((s) => s.snapshot);
    const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
    const reloadRequired = useProjectSkillsStore((s) => s.reloadRequired);
    const planPending = useProjectSkillsStore((s) => s.planPending);
    const applyPending = useProjectSkillsStore((s) => s.applyPending);

    const [nameDraft, setNameDraft] = useState("");
    const [skillMd, setSkillMd] = useState(() =>
      blankSkillMd("", t("settings.skills.blankDefaultDescription"), t)
    );
    const [contentDirty, setContentDirty] = useState(false);
    const [contentInvalid, setContentInvalid] = useState(false);
    const [skillDelivery, setSkillDelivery] = useState({
      agents: false,
      claude: false,
    });
    const [saving, setSaving] = useState(false);

    const nameTrimmed = nameDraft.trim();
    const nameReserved = nameTrimmed.startsWith(PIER_SYSTEM_SKILL_PREFIX);
    const nameInvalid =
      nameTrimmed.length > 0 && (!isValidSkillId(nameTrimmed) || nameReserved);
    const nameTaken = Boolean(
      nameTrimmed && snapshot?.skills.some((entry) => entry.id === nameTrimmed)
    );
    const nameOk = isValidSkillId(nameTrimmed) && !nameReserved && !nameTaken;
    const enabled = skillDelivery.agents || skillDelivery.claude;
    const projectDelivery = snapshot?.manifest?.delivery
      ? {
          agents: Boolean(snapshot.manifest.delivery.agents),
          claude: Boolean(snapshot.manifest.delivery.claude),
        }
      : { agents: true, claude: false };
    const effects = useMemo(() => {
      const byAgent = new Map(
        (snapshot?.skills ?? []).flatMap((skill) =>
          skill.effects.map((cell) => [cell.agentKind, cell] as const)
        )
      );
      return [...byAgent.values()];
    }, [snapshot?.skills]);
    const commitDisabled =
      saving ||
      writesFrozen ||
      reloadRequired ||
      planPending ||
      applyPending ||
      !projectRef;

    useEffect(() => {
      setTitle(t("settings.skills.addSkill"));
    }, [setTitle, t]);

    useEffect(() => {
      setOnDismissRequest(() => !saving);
      return () => {
        setOnDismissRequest(null);
      };
    }, [saving, setOnDismissRequest]);

    function updateName(next: string) {
      setNameDraft(next);
      const trimmed = next.trim();
      if (
        !(
          isValidSkillId(trimmed) &&
          !trimmed.startsWith(PIER_SYSTEM_SKILL_PREFIX)
        )
      ) {
        return;
      }
      if (contentDirty) {
        setSkillMd((prev) => replaceSkillMdName(prev, trimmed));
        return;
      }
      setSkillMd(
        blankSkillMd(trimmed, t("settings.skills.blankDefaultDescription"), t)
      );
    }

    async function confirmAdd() {
      if (!(projectRef && nameOk) || commitDisabled) return;
      const finalMd = replaceSkillMdName(
        contentDirty
          ? skillMd
          : blankSkillMd(
              nameTrimmed,
              t("settings.skills.blankDefaultDescription"),
              t
            ),
        nameTrimmed
      );
      if (!skillMdNameMatchesId(finalMd, nameTrimmed)) {
        setContentDirty(true);
        setSkillMd(finalMd);
        setContentInvalid(true);
        return;
      }
      if (!extractSkillMdDescription(finalMd)) {
        setContentDirty(true);
        setSkillMd(finalMd);
        setContentInvalid(true);
        return;
      }
      setContentInvalid(false);
      setSaving(true);
      let templateCandidate: { token: string } | null = null;
      let updateCandidate: { token: string } | null = null;
      let appliedTemplate = false;
      try {
        const description =
          extractSkillMdDescription(finalMd) ||
          t("settings.skills.blankDefaultDescription");
        const candidate = await window.pier.projectSkills.importPrepareTemplate(
          projectRef,
          { skillId: nameTrimmed, description }
        );
        if (!isImportCandidate(candidate)) {
          await showAppAlert({
            title: t("settings.skills.createFailed"),
            body: t("settings.skills.createFailedBody"),
          });
          return;
        }
        templateCandidate = candidate;
        const intent = emptyDraft(projectDelivery);
        intent.importTokens = [candidate.token];
        intent.enabledBySkillId[nameTrimmed] = enabled;
        intent.deliveryBySkillId[nameTrimmed] = skillDelivery;
        if (skillDelivery.agents) intent.deliveryAgents = true;
        if (skillDelivery.claude) intent.deliveryClaude = true;

        const created = await commitSkillsIntent({
          draft: intent,
          skipConfirmations: true,
          suppressFailureAlerts: true,
          t,
        });
        if (created === "indeterminate") {
          templateCandidate = null;
          await showAppAlert({
            title: t("settings.skills.applyIndeterminate"),
            body: t("settings.skills.operationNotApplied"),
          });
          return;
        }
        if (!(created === "converged" || created === "degraded")) {
          await discardPreparedCandidate(projectRef, candidate);
          templateCandidate = null;
          if (created !== "cancelled") {
            const storeMessage = useProjectSkillsStore.getState().errorMessage;
            await showAppAlert({
              title: t("settings.skills.createFailed"),
              body: skillsErrorMessage(
                storeMessage,
                t,
                "settings.skills.createFailedBody"
              ),
            });
          }
          return;
        }
        templateCandidate = null;
        appliedTemplate = true;

        const templateMd = blankSkillMd(nameTrimmed, description, t);
        const needsContentUpdate =
          finalMd.trim().length > 0 && finalMd.trim() !== templateMd.trim();
        if (!needsContentUpdate) {
          close(null);
          return;
        }

        const idle = await waitForSkillsIdle();
        if (!idle) {
          await showAppAlert({
            title: t("settings.skills.createFailed"),
            body: t("settings.skills.createContentSaveFailedBody"),
          });
          close(null);
          return;
        }
        const createdSkill = useProjectSkillsStore
          .getState()
          .snapshot?.skills.find((entry) => entry.id === nameTrimmed);
        if (!createdSkill) {
          await showAppAlert({
            title: t("settings.skills.createFailed"),
            body: t("settings.skills.createContentSaveFailedBody"),
          });
          close(null);
          return;
        }
        try {
          const prepared =
            await window.pier.projectSkills.importPrepareContentUpdate(
              projectRef,
              {
                skillId: nameTrimmed,
                baseContentDigest: createdSkill.contentDigest,
                skillMd: finalMd,
              }
            );
          if (!isImportCandidate(prepared)) {
            await showAppAlert({
              title: t("settings.skills.createFailed"),
              body: t("settings.skills.createContentSaveFailedBody"),
            });
            close(null);
            return;
          }
          updateCandidate = prepared;
          const updateIntent = emptyDraft(projectDelivery);
          updateIntent.importTokens = [prepared.token];
          const updated = await commitSkillsIntent({
            draft: updateIntent,
            skipConfirmations: true,
            suppressFailureAlerts: true,
            t,
          });
          if (updated === "indeterminate") {
            updateCandidate = null;
            await showAppAlert({
              title: t("settings.skills.applyIndeterminate"),
              body: t("settings.skills.operationNotApplied"),
            });
            close(null);
            return;
          }
          if (!(updated === "converged" || updated === "degraded")) {
            await discardPreparedCandidate(projectRef, prepared);
            updateCandidate = null;
            const storeMessage = useProjectSkillsStore.getState().errorMessage;
            await showAppAlert({
              title: t("settings.skills.createFailed"),
              body: skillsErrorMessage(
                storeMessage,
                t,
                "settings.skills.createContentSaveFailedBody"
              ),
            });
            close(null);
            return;
          }
          updateCandidate = null;
        } catch (error) {
          if (updateCandidate) {
            await discardPreparedCandidate(projectRef, updateCandidate);
            updateCandidate = null;
          }
          await showAppAlert({
            title: t("settings.skills.createFailed"),
            body: skillsErrorMessage(
              error,
              t,
              "settings.skills.createFailedBody"
            ),
          });
          close(null);
          return;
        }
        close(null);
      } catch (error) {
        if (templateCandidate && !appliedTemplate) {
          await discardPreparedCandidate(projectRef, templateCandidate);
        }
        if (updateCandidate) {
          await discardPreparedCandidate(projectRef, updateCandidate);
        }
        await showAppAlert({
          title: t("settings.skills.createFailed"),
          body: skillsErrorMessage(
            error,
            t,
            "settings.skills.createFailedBody"
          ),
        });
      } finally {
        setSaving(false);
      }
    }

    // Avoid stale name/content when the footer stays memoized while nameOk is true.
    const confirmAddRef = useRef(confirmAdd);
    confirmAddRef.current = confirmAdd;

    const footer = useMemo(
      () => (
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={saving}
            onClick={() => {
              close(null);
            }}
            type="button"
            variant="outline"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            disabled={!nameOk || commitDisabled}
            onClick={() => {
              confirmAddRef.current().catch(() => undefined);
            }}
            type="button"
          >
            {t("settings.skills.confirmAdd")}
          </Button>
        </div>
      ),
      [close, commitDisabled, nameOk, saving, t]
    );
    useContentDialogFooter(setFooter, footer);

    return (
      <div className={DIALOG_COMMIT_FORM_CLASS} data-slot="dialog-commit-form">
        <Field data-invalid={nameInvalid || nameTaken || undefined}>
          <FieldLabel htmlFor="skills-create-name">
            {t("settings.skills.blankIdTitle")}
          </FieldLabel>
          <Input
            aria-describedby={
              nameInvalid || nameTaken
                ? "skills-create-name-help skills-create-name-error"
                : "skills-create-name-help"
            }
            aria-invalid={nameInvalid || nameTaken || undefined}
            autoFocus
            disabled={commitDisabled}
            id="skills-create-name"
            onChange={(event) => {
              updateName(event.target.value);
            }}
            value={nameDraft}
          />
          <FieldDescription id="skills-create-name-help">
            {t("settings.skills.blankIdBody")}
          </FieldDescription>
          {nameInvalid || nameTaken ? (
            <FieldError id="skills-create-name-error">
              {(() => {
                if (nameTaken) return t("settings.skills.blankIdTaken");
                if (nameReserved) return t("settings.skills.blankIdReserved");
                return t("settings.skills.blankIdInvalid");
              })()}
            </FieldError>
          ) : null}
        </Field>

        <SkillDetailSection title={t("settings.skills.matrixTitle")}>
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t("settings.skills.discoveryChannelsHintAdd")}
            </p>
            <SkillsDiscoveryChannelEditor
              disabled={commitDisabled}
              effects={effects}
              enabled={enabled}
              onChannelChange={(channel: PierDiscoveryChannelId, checked) => {
                if (commitDisabled) return;
                setSkillDelivery((current) => ({
                  agents: channel === "agents" ? checked : current.agents,
                  claude: channel === "claude" ? checked : current.claude,
                }));
              }}
              projectDelivery={projectDelivery}
              skillDelivery={skillDelivery}
              t={t}
            />
          </div>
        </SkillDetailSection>

        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          {contentInvalid ? (
            <FieldError>{t("settings.skills.createSkillMdInvalid")}</FieldError>
          ) : null}
          <MarkdownSourceEditor
            ariaLabel={t("settings.skills.contentTitle")}
            onChange={(next) => {
              if (commitDisabled) return;
              setContentDirty(true);
              setContentInvalid(false);
              setSkillMd(next);
            }}
            readOnly={commitDisabled}
            value={skillMd}
          />
        </SkillDetailSection>
      </div>
    );
  }

  return openAppContentDialog({
    content: Body,
    id: "skills-create-blank",
    size: "lg",
    title: i18next.t("settings.skills.addSkill"),
  }).result as Promise<null>;
}
