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
import { blankSkillMd, isValidSkillId } from "./skills/blank-md.ts";
import { SkillDetailSection } from "./skills/detail-section.tsx";
import { skillsErrorMessage } from "./skills/error-copy.ts";
import {
  extractSkillMdDescription,
  replaceSkillMdName,
  skillMdNameMatchesId,
} from "./skills/md-description.ts";

/**
 * Pier Home add-skill dialog: nothing is written until the user confirms.
 */
export function openPierHomeCreateSkillDialog(
  existingIds: readonly string[]
): Promise<boolean> {
  const takenIds = new Set(existingIds);

  function Body({
    close,
    setFooter,
    setOnDismissRequest,
    setTitle,
  }: AppContentDialogRenderProps<boolean>) {
    const t = useT();
    const [nameDraft, setNameDraft] = useState("");
    const [skillMd, setSkillMd] = useState(() =>
      blankSkillMd("", t("settings.skills.blankDefaultDescription"), t)
    );
    const [contentDirty, setContentDirty] = useState(false);
    const [contentInvalid, setContentInvalid] = useState(false);
    const [saving, setSaving] = useState(false);

    const nameTrimmed = nameDraft.trim();
    const nameReserved = nameTrimmed.startsWith(PIER_SYSTEM_SKILL_PREFIX);
    const nameInvalid =
      nameTrimmed.length > 0 && (!isValidSkillId(nameTrimmed) || nameReserved);
    const nameTaken = Boolean(nameTrimmed && takenIds.has(nameTrimmed));
    const nameOk = isValidSkillId(nameTrimmed) && !nameReserved && !nameTaken;
    const writesDisabled = saving;

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
      if (!isValidSkillId(trimmed)) return;
      if (contentDirty) {
        setSkillMd((prev) => replaceSkillMdName(prev, trimmed));
        return;
      }
      setSkillMd(
        blankSkillMd(trimmed, t("settings.skills.blankDefaultDescription"), t)
      );
    }

    async function confirmAdd() {
      if (!nameOk || writesDisabled) return;
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
      let createdId: string | null = null;
      try {
        const description =
          extractSkillMdDescription(finalMd) ||
          t("settings.skills.blankDefaultDescription");
        await window.pier.pierHomeSkills.create({
          skillId: nameTrimmed,
          description,
        });
        createdId = nameTrimmed;
        const templateMd = blankSkillMd(nameTrimmed, description, t);
        if (finalMd.trim().length > 0 && finalMd.trim() !== templateMd.trim()) {
          await window.pier.pierHomeSkills.write(nameTrimmed, finalMd);
        }
        close(true);
      } catch (err) {
        if (createdId) {
          try {
            await window.pier.pierHomeSkills.delete(createdId);
          } catch {
            // Best-effort rollback so cancel/retry does not leave orphans.
          }
        }
        await showAppAlert({
          title: t("settings.projects.pierHomeSkillsCreateFailed"),
          body: skillsErrorMessage(err, t, "settings.skills.createFailedBody"),
        });
      } finally {
        setSaving(false);
      }
    }

    const confirmAddRef = useRef(confirmAdd);
    confirmAddRef.current = confirmAdd;

    const footer = useMemo(
      () => (
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={writesDisabled}
            onClick={() => {
              close(false);
            }}
            type="button"
            variant="outline"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            disabled={!nameOk || writesDisabled}
            onClick={() => {
              confirmAddRef.current().catch(() => undefined);
            }}
            type="button"
          >
            {t("settings.skills.confirmAdd")}
          </Button>
        </div>
      ),
      [close, nameOk, t, writesDisabled]
    );
    useContentDialogFooter(setFooter, footer);

    return (
      <div className={DIALOG_COMMIT_FORM_CLASS} data-slot="dialog-commit-form">
        <Field data-invalid={nameInvalid || nameTaken || undefined}>
          <FieldLabel htmlFor="pier-home-create-name">
            {t("settings.skills.blankIdTitle")}
          </FieldLabel>
          <Input
            aria-describedby={
              nameInvalid || nameTaken
                ? "pier-home-create-name-help pier-home-create-name-error"
                : "pier-home-create-name-help"
            }
            aria-invalid={nameInvalid || nameTaken || undefined}
            autoFocus
            disabled={writesDisabled}
            id="pier-home-create-name"
            onChange={(event) => {
              updateName(event.target.value);
            }}
            value={nameDraft}
          />
          <FieldDescription id="pier-home-create-name-help">
            {t("settings.skills.blankIdBody")}
          </FieldDescription>
          {nameInvalid || nameTaken ? (
            <FieldError id="pier-home-create-name-error">
              {(() => {
                if (nameTaken) return t("settings.skills.blankIdTaken");
                if (nameReserved) return t("settings.skills.blankIdReserved");
                return t("settings.skills.blankIdInvalid");
              })()}
            </FieldError>
          ) : null}
        </Field>

        <SkillDetailSection title={t("settings.skills.contentTitle")}>
          {contentInvalid ? (
            <FieldError>{t("settings.skills.createSkillMdInvalid")}</FieldError>
          ) : null}
          <MarkdownSourceEditor
            ariaLabel={t("settings.skills.contentTitle")}
            onChange={(next) => {
              if (writesDisabled) return;
              setContentDirty(true);
              setContentInvalid(false);
              setSkillMd(next);
            }}
            readOnly={writesDisabled}
            value={skillMd}
          />
        </SkillDetailSection>
      </div>
    );
  }

  return openAppContentDialog({
    content: Body,
    id: "pier-home-create-blank",
    size: "lg",
    title: i18next.t("settings.skills.addSkill"),
  }).result.then((value) => value === true);
}
