import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { DIALOG_FOOTER_ACTIONS_CLASS } from "@pier/ui/dialog-form-layout.ts";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  noopContentDialogSetFooter,
  useContentDialogFooter,
} from "@/components/common/dialogs/use-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills/store.ts";
import {
  liveDiscoveryDraft,
  useSkillsSkillDetailActions,
} from "./detail-actions.ts";
import { SkillsSkillDetailPanels } from "./detail-panels.tsx";
import { confirmDiscardSkillEditDrafts, sourceLabel } from "./shared.tsx";

/**
 * Skill detail: user-managed skills open directly in the editor; system
 * skills use the same page shell with read-only content.
 *
 * `presentation: "dialog"` matches Pier Home (secondary content dialog +
 * CodeMirror); list stays underneath Settings.
 * Create flow is `openSkillsCreateSkillDialog` (confirm-before-write).
 */
export function SkillsSkillDetail({
  skillId,
  onBack,
  presentation = "page",
  setOnDismissRequest,
  setFooter,
  setTitle,
}: {
  skillId: string;
  onBack: () => void;
  presentation?: "page" | "dialog";
  setOnDismissRequest?: (
    handler: (() => boolean | Promise<boolean>) | null
  ) => void;
  setFooter?: (footer: ReactNode | null) => void;
  setTitle?: (title: string) => void;
}) {
  const t = useT();
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const snapshot = useProjectSkillsStore((s) => s.snapshot);
  const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
  const reloadRequired = useProjectSkillsStore((s) => s.reloadRequired);
  const applyPending = useProjectSkillsStore((s) => s.applyPending);
  const planPending = useProjectSkillsStore((s) => s.planPending);
  const editDraftBySkillId = useProjectSkillsStore((s) => s.editDraftBySkillId);
  const setEditDraft = useProjectSkillsStore((s) => s.setEditDraft);
  const titleId = useId();

  const hasEditDraft = Object.hasOwn(editDraftBySkillId, skillId);
  const [content, setContent] = useState<{
    skillMd: string;
    truncated: boolean;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const contentRequestRef = useRef(0);
  const prepareRequestRef = useRef(0);
  const [preparePending, setPreparePending] = useState(false);
  const editorText = hasEditDraft
    ? (editDraftBySkillId[skillId] ?? "")
    : (content?.skillMd ?? "");

  const skill = snapshot?.skills.find((entry) => entry.id === skillId) ?? null;

  const [discoveryDraft, setDiscoveryDraft] = useState<ReturnType<
    typeof liveDiscoveryDraft
  > | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset draft when navigating skills
  useEffect(() => {
    setDiscoveryDraft(null);
  }, [skillId]);

  useEffect(
    () => () => {
      prepareRequestRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (!setTitle) return;
    setTitle(skill?.name || skillId);
  }, [setTitle, skill?.name, skillId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = retryNonce;
    contentRequestRef.current = requestId;
    setContent(null);
    setLoadFailed(false);
    if (!projectRef) {
      return;
    }
    window.pier.projectSkills
      .skillRead(projectRef, { kind: "managed", skillId })
      .then((result) => {
        if (!cancelled && contentRequestRef.current === requestId) {
          setContent(result);
        }
      })
      .catch(() => {
        if (!cancelled && contentRequestRef.current === requestId) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectRef, retryNonce, skillId]);

  const writesDisabled =
    writesFrozen ||
    reloadRequired ||
    planPending ||
    applyPending ||
    preparePending;
  const isSystem = skill?.managedBy === "pier-system";
  const isPierBound = skill?.managedBy === "pier-bound";
  const libraryPath = skill ? `.pier/skills/library/${skill.id}` : "";
  const saving = preparePending || applyPending || planPending;
  const projectDelivery = {
    agents: Boolean(snapshot?.manifest?.delivery?.agents),
    claude: Boolean(snapshot?.manifest?.delivery?.claude),
  };
  const liveDiscovery = skill
    ? liveDiscoveryDraft({
        enabled: skill.enabled,
        projectDelivery,
        skillDelivery: skill.delivery,
      })
    : null;
  const effectiveDiscovery = discoveryDraft ?? liveDiscovery;
  const discoveryDirty =
    discoveryDraft !== null &&
    liveDiscovery !== null &&
    (discoveryDraft.enabled !== liveDiscovery.enabled ||
      discoveryDraft.skillDelivery.agents !==
        liveDiscovery.skillDelivery.agents ||
      discoveryDraft.skillDelivery.claude !==
        liveDiscovery.skillDelivery.claude);
  const formDirty = hasEditDraft || discoveryDirty;

  async function confirmDiscardEditDraft(): Promise<boolean> {
    const state = useProjectSkillsStore.getState();
    const contentDirty = Object.hasOwn(state.editDraftBySkillId, skillId);
    if (!(contentDirty || discoveryDirty)) {
      return true;
    }
    if (!contentDirty && discoveryDirty) {
      return showAppConfirm({
        body: t("settings.skills.leaveEditBody"),
        intent: "destructive",
        title: t("settings.skills.leaveEditTitle"),
      });
    }
    return confirmDiscardSkillEditDrafts(t);
  }

  const { copyLibraryPath, deleteSkill, saveEdit } =
    useSkillsSkillDetailActions({
      discoveryDraft,
      discoveryDirty,
      editorText,
      hasEditDraft,
      isSystem: Boolean(isSystem || isPierBound),
      libraryPath,
      onBack,
      preparePending,
      prepareRequestRef,
      projectRef,
      setContent,
      setDiscoveryDraft,
      setEditDraft,
      setPreparePending,
      setRetryNonce,
      skill,
      skillId,
      snapshot,
      writesDisabled,
    });

  async function handleBack() {
    if (!(await confirmDiscardEditDraft())) {
      return;
    }
    setEditDraft(skillId, null);
    setDiscoveryDraft(null);
    onBack();
  }

  const confirmDiscardEditDraftRef = useRef(confirmDiscardEditDraft);
  confirmDiscardEditDraftRef.current = confirmDiscardEditDraft;

  useEffect(() => {
    if (!setOnDismissRequest) return;
    setOnDismissRequest(async () => {
      const ok = await confirmDiscardEditDraftRef.current();
      if (ok) {
        setEditDraft(skillId, null);
        setDiscoveryDraft(null);
      }
      return ok;
    });
    return () => {
      setOnDismissRequest(null);
    };
  }, [setEditDraft, setOnDismissRequest, skillId]);

  async function handleSave() {
    const result = await saveEdit();
    if (
      presentation === "dialog" &&
      (result === "converged" || result === "degraded")
    ) {
      onBack();
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: action closures
  const dialogFooter = useMemo(() => {
    if (presentation !== "dialog" || isSystem || isPierBound) return null;
    const saveDisabled =
      !formDirty ||
      (hasEditDraft && editorText.trim().length === 0) ||
      writesDisabled;
    return (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          disabled={writesDisabled}
          onClick={() => {
            deleteSkill().catch(() => undefined);
          }}
          type="button"
          variant="destructive"
        >
          <Trash2 data-icon="inline-start" />
          {t("settings.skills.deleteSkill")}
        </Button>
        <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
          <Button
            disabled={writesDisabled}
            onClick={() => {
              handleBack().catch(() => undefined);
            }}
            type="button"
            variant="outline"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            disabled={saveDisabled}
            onClick={() => {
              handleSave().catch(() => undefined);
            }}
            type="button"
          >
            {saving ? (
              <Loader2
                aria-hidden
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : null}
            {t("settings.skills.editSave")}
          </Button>
        </div>
      </div>
    );
  }, [
    editorText,
    formDirty,
    hasEditDraft,
    isPierBound,
    isSystem,
    presentation,
    saving,
    t,
    writesDisabled,
  ]);
  useContentDialogFooter(setFooter ?? noopContentDialogSetFooter, dialogFooter);

  if (!(skill && projectRef)) {
    return (
      <div className="flex items-center gap-3">
        <Button
          aria-label={t("settings.skills.skillDetailBack")}
          onClick={() => {
            handleBack().catch(() => undefined);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <p className="text-muted-foreground text-sm">
          {t("settings.skills.loadFailed")}
        </p>
      </div>
    );
  }

  const riskFrontmatterKeys = Object.keys(
    skill.riskSummary?.riskFrontmatter ?? {}
  );
  const riskParts: string[] = [];
  if (skill.riskSummary && skill.riskSummary.executables.length > 0) {
    riskParts.push(
      t("settings.skills.riskExecutables", {
        count: skill.riskSummary.executables.length,
      })
    );
  }
  if (skill.riskSummary && skill.riskSummary.dynamicCommandTraces.length > 0) {
    riskParts.push(
      t("settings.skills.riskDynamic", {
        count: skill.riskSummary.dynamicCommandTraces.length,
      })
    );
  }
  if (riskFrontmatterKeys.length > 0) {
    riskParts.push(
      t("settings.skills.riskFrontmatter", {
        keys: riskFrontmatterKeys.join(", "),
      })
    );
  }
  const hasRisk = riskParts.length > 0;
  const riskLine = riskParts.join(" · ");
  const policyEnabled = effectiveDiscovery?.enabled ?? false;
  const skillDelivery = effectiveDiscovery?.skillDelivery ?? null;

  return (
    <div
      aria-busy={planPending || applyPending || preparePending}
      className="flex min-w-0 flex-col gap-4"
    >
      {presentation === "page" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            aria-label={t("settings.skills.skillDetailBack")}
            onClick={() => {
              handleBack().catch(() => undefined);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowLeft data-icon="inline-start" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="truncate text-lg" id={titleId} tabIndex={-1}>
              {skill.name || skill.id}
              {isSystem ? (
                <Badge className="ml-2" variant="secondary">
                  {t("settings.skills.systemBadge")}
                </Badge>
              ) : (
                <Badge className="ml-2" variant="outline">
                  {sourceLabel(skill, t)}
                </Badge>
              )}
            </h2>
            <span className="truncate font-mono text-muted-foreground text-xs">
              {libraryPath}
            </span>
          </div>
        </div>
      ) : null}

      <SkillsSkillDetailPanels
        content={content}
        copyLibraryPath={copyLibraryPath}
        description={skill.description}
        editorText={editorText}
        effects={skill.effects}
        enabled={policyEnabled}
        fileCount={skill.fileCount}
        hasEditDraft={hasEditDraft}
        hasRisk={hasRisk}
        isSystem={Boolean(isSystem || isPierBound)}
        libraryPath={libraryPath}
        loadFailed={loadFailed}
        onChannelChange={(channel, checked) => {
          if (writesDisabled) return;
          const current = effectiveDiscovery?.skillDelivery ?? {
            agents: false,
            claude: false,
          };
          const nextSkillDelivery = {
            agents: channel === "agents" ? checked : current.agents,
            claude: channel === "claude" ? checked : current.claude,
          };
          const next = {
            enabled: nextSkillDelivery.agents || nextSkillDelivery.claude,
            skillDelivery: nextSkillDelivery,
          };
          if (
            liveDiscovery &&
            next.enabled === liveDiscovery.enabled &&
            next.skillDelivery.agents === liveDiscovery.skillDelivery.agents &&
            next.skillDelivery.claude === liveDiscovery.skillDelivery.claude
          ) {
            setDiscoveryDraft(null);
            return;
          }
          setDiscoveryDraft(next);
        }}
        onDelete={() => {
          deleteSkill().catch(() => undefined);
        }}
        onDiscard={() => {
          setEditDraft(skill.id, null);
          setDiscoveryDraft(null);
        }}
        onDraftChange={(next) => {
          if (writesDisabled) return;
          if (content && next === content.skillMd) {
            setEditDraft(skill.id, null);
          } else {
            setEditDraft(skill.id, next);
          }
        }}
        onRetry={() => {
          setRetryNonce((value) => value + 1);
        }}
        onSave={() => {
          handleSave().catch(() => undefined);
        }}
        presentation={presentation}
        projectDelivery={projectDelivery}
        riskLine={riskLine}
        skillDelivery={skillDelivery}
        sourceBadge={
          isSystem ? (
            <Badge variant="secondary">
              {t("settings.skills.systemBadge")}
            </Badge>
          ) : (
            <Badge variant="outline">{sourceLabel(skill, t)}</Badge>
          )
        }
        t={t}
        totalBytes={skill.totalBytes}
        writesDisabled={writesDisabled}
      />
    </div>
  );
}
