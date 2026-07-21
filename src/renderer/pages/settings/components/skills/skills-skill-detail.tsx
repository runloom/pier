import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import { ArrowLeft, Copy, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import {
  SkillContentBody,
  SkillsEffectMatrixCard,
} from "./skills-readonly-detail.tsx";
import {
  confirmDiscardSkillEditDrafts,
  formatBytes,
  sourceLabel,
} from "./skills-shared.tsx";
import { useSkillsSkillDetailActions } from "./skills-skill-detail-actions.ts";

/**
 * Skill detail: user-managed skills open directly in the editor; system
 * skills use the same page shell with read-only content.
 */
export function SkillsSkillDetail({
  skillId,
  onBack,
}: {
  skillId: string;
  onBack: () => void;
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
  const enableLabelId = useId();

  // Drafts exist only while text differs from loaded content (§7.7).
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

  useEffect(
    () => () => {
      prepareRequestRef.current += 1;
    },
    []
  );

  const skill = snapshot?.skills.find((entry) => entry.id === skillId) ?? null;

  // Load library SKILL.md; keep any existing dirty draft over the re-read.
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

  async function confirmDiscardEditDraft(): Promise<boolean> {
    if (
      !Object.hasOwn(
        useProjectSkillsStore.getState().editDraftBySkillId,
        skillId
      )
    ) {
      return true;
    }
    return confirmDiscardSkillEditDrafts(t);
  }

  async function handleBack() {
    if (!(await confirmDiscardEditDraft())) {
      return;
    }
    onBack();
  }

  const writesDisabled =
    writesFrozen ||
    reloadRequired ||
    planPending ||
    applyPending ||
    preparePending;
  const isSystem = skill?.managedBy === "pier-system";
  const drifted = Boolean(
    skill?.issueIds.some((id) => id.startsWith("library-drift"))
  );
  const libraryPath = skill ? `.pier/skills/library/${skill.id}` : "";

  const {
    adoptCurrentFiles,
    copyLibraryPath,
    deleteSkill,
    saveEdit,
    toggleEnabled,
  } = useSkillsSkillDetailActions({
    editorText,
    isSystem: Boolean(isSystem),
    libraryPath,
    onBack,
    preparePending,
    prepareRequestRef,
    projectRef,
    setContent,
    setEditDraft,
    setPreparePending,
    setRetryNonce,
    skill,
    skillId,
    snapshot,
    writesDisabled,
  });

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

  return (
    // min-w-0: shrink in the settings flex row so wide headers/cards do not
    // overflow and get clipped (design §7.8 — no horizontal scroll; truncate).
    <div
      aria-busy={planPending || applyPending}
      className="flex min-w-0 flex-col gap-4"
    >
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
        <div className="flex shrink-0 items-center gap-2">
          {isSystem ? null : (
            <>
              <span className="sr-only" id={enableLabelId}>
                {t("settings.skills.enableSkill")}
              </span>
              <Switch
                aria-labelledby={`${enableLabelId} ${titleId}`}
                checked={skill.enabled}
                disabled={writesDisabled}
                onCheckedChange={(checked) => {
                  toggleEnabled(checked).catch(() => undefined);
                }}
              />
              <span className="text-muted-foreground text-xs">
                {skill.enabled
                  ? t("settings.skills.skillOn")
                  : t("settings.skills.skillOff")}
              </span>
              <Button
                disabled={writesDisabled}
                onClick={() => {
                  deleteSkill().catch(() => undefined);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Trash2 data-icon="inline-start" />
                {t("settings.skills.deleteSkill")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.metadataTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {drifted ? (
            // Drift alert lives inside the details card. Adopting the current
            // files updates Pier's recorded baseline immediately.
            <Alert variant="destructive">
              <AlertTitle>{t("settings.skills.driftTitle")}</AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.driftBody")}
                  <span className="flex justify-end">
                    <Button
                      disabled={writesDisabled}
                      onClick={() => {
                        adoptCurrentFiles().catch(() => undefined);
                      }}
                      size="sm"
                      type="button"
                    >
                      {t("settings.skills.driftUseCurrent")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {skill.description ? (
            <p className="text-sm">{skill.description}</p>
          ) : null}
          <p className="font-mono text-muted-foreground text-xs">
            {t("settings.skills.metadataFiles", {
              count: skill.fileCount,
              size: formatBytes(skill.totalBytes),
            })}
          </p>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-muted-foreground text-xs">
              {libraryPath}
            </span>
            <Button
              aria-label={t("settings.skills.copyPath")}
              onClick={() => {
                copyLibraryPath().catch(() => undefined);
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Copy data-icon="inline-start" />
            </Button>
          </div>
          {hasRisk ? (
            <p
              className="flex items-center gap-1 text-status-warning-fg text-xs"
              title={t("settings.skills.riskDisclaimer")}
            >
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              {riskLine}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <SkillsEffectMatrixCard effects={skill.effects} t={t} />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.skills.contentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isSystem ? (
            <SkillContentBody
              content={content}
              displayPath={libraryPath}
              loadFailed={loadFailed}
              onRetry={() => {
                setRetryNonce((value) => value + 1);
              }}
              t={t}
            />
          ) : (
            <>
              <Textarea
                className="min-h-64 font-mono"
                disabled={writesDisabled}
                onChange={(event) => {
                  if (writesDisabled) return;
                  const next = event.target.value;
                  if (content && next === content.skillMd) {
                    setEditDraft(skill.id, null);
                  } else {
                    setEditDraft(skill.id, next);
                  }
                }}
                value={editorText}
              />
              <div className="flex justify-end gap-2">
                <Button
                  disabled={!hasEditDraft || writesDisabled}
                  onClick={() => {
                    setEditDraft(skill.id, null);
                  }}
                  type="button"
                  variant="outline"
                >
                  {t("settings.skills.editDiscard")}
                </Button>
                <Button
                  disabled={
                    !hasEditDraft ||
                    editorText.trim().length === 0 ||
                    writesDisabled
                  }
                  onClick={() => {
                    saveEdit().catch(() => undefined);
                  }}
                  type="button"
                >
                  {t("settings.skills.editSave")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
