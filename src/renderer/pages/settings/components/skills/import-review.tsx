import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { StatusStack } from "@pier/ui/status-stack.tsx";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type ImportCandidateView,
  useProjectSkillsStore,
} from "@/stores/project-skills/store.ts";
import { buildSkillsImportStatusItems } from "./build-import-status-items.ts";
import { SkillContentBody } from "./readonly-detail.tsx";
import { formatBytes, type Translate } from "./shared.tsx";

/**
 * Templates are composed locally and have no meaningful source path.
 */
function sourceLine(candidate: ImportCandidateView, t: Translate): string {
  if (candidate.sourceKind === "template") {
    return t("settings.skills.sourceTemplate");
  }
  return t("settings.skills.importSource", {
    path: candidate.sourceDisplayPath,
  });
}

/**
 * Import/adoption inspection page. Existing managed skills save in their
 * editor and never route through this preview.
 */
export function SkillsImportReview({
  candidate,
  conflict = false,
  onCancel,
  onConflictResolve,
  onConfirm,
}: {
  candidate: ImportCandidateView;
  /** Library id conflict: no overwrite, no rename. */
  conflict?: boolean;
  onCancel: () => void;
  onConflictResolve?: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const applyPending = useProjectSkillsStore((s) => s.applyPending);
  const planPending = useProjectSkillsStore((s) => s.planPending);
  const reloadRequired = useProjectSkillsStore((s) => s.reloadRequired);
  const actionBlocked = useProjectSkillsStore(
    (s) => s.errorMessage === "action-blocked"
  );
  const [deadlineNow, setDeadlineNow] = useState(() => Date.now());
  useEffect(() => {
    const delay = Math.max(0, candidate.expiresAt - Date.now());
    const timer = window.setTimeout(
      () => {
        setDeadlineNow(Date.now());
      },
      Math.min(delay + 1, 2_147_483_647)
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [candidate.expiresAt]);
  const expired = candidate.expiresAt <= deadlineNow;
  const statusItems = useMemo(
    () =>
      buildSkillsImportStatusItems({
        actionBlocked,
        conflict,
        expired,
        onConflictResolve,
        reloadRequired,
        riskSummary: candidate.riskSummary,
        skillId: candidate.skillId,
        t,
      }),
    [
      actionBlocked,
      candidate.riskSummary,
      candidate.skillId,
      conflict,
      expired,
      onConflictResolve,
      reloadRequired,
      t,
    ]
  );
  const isReadOnlyCopy =
    candidate.sourceKind === "project-discovery-import" ||
    candidate.sourceKind === "local-import";
  const needsReload = conflict || reloadRequired;
  const blocked = expired || needsReload || actionBlocked;
  const contentReady = candidate.skillMdPreview !== undefined;
  const writePending = planPending || applyPending;

  let title = t("settings.skills.importTitle");
  if (candidate.sourceKind === "template") {
    // Nothing was imported — the user just created this skill locally.
    title = t("settings.skills.previewTemplateTitle");
  }
  const primaryLabel = t("settings.skills.addSkillCommit");

  return (
    <div aria-busy={writePending} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          aria-label={t("settings.skills.skillDetailBack")}
          onClick={onCancel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-lg" tabIndex={-1}>
            {title}
          </h2>
          <span className="truncate font-mono text-muted-foreground text-xs">
            {sourceLine(candidate, t)}
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{candidate.name || candidate.skillId}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {candidate.description ? (
            <p className="text-sm">{candidate.description}</p>
          ) : null}
          <p className="font-mono text-muted-foreground text-xs">
            {t("settings.skills.metadataFiles", {
              count: candidate.fileCount,
              size: formatBytes(candidate.totalBytes),
            })}
          </p>
          {candidate.directorySummary ? (
            <p className="font-mono text-muted-foreground text-xs">
              SKILL.md
              {candidate.directorySummary.scripts > 0
                ? ` · scripts/ ${candidate.directorySummary.scripts}`
                : ""}
              {candidate.directorySummary.references > 0
                ? ` · references/ ${candidate.directorySummary.references}`
                : ""}
              {candidate.directorySummary.assets > 0
                ? ` · assets/ ${candidate.directorySummary.assets}`
                : ""}
              {candidate.directorySummary.otherFiles > 0
                ? ` · +${candidate.directorySummary.otherFiles}`
                : ""}
            </p>
          ) : null}

          {statusItems.length > 0 ? (
            <StatusStack
              data-testid="skills-import-status-stack"
              items={statusItems}
            />
          ) : null}

          {candidate.skillMdPreview === undefined ? null : (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs">
                {t("settings.skills.contentTitle")}
              </p>
              <SkillContentBody
                content={{
                  skillMd: candidate.skillMdPreview,
                  truncated: Boolean(candidate.skillMdTruncated),
                }}
                displayPath={candidate.sourceDisplayPath}
                loadFailed={false}
                t={t}
              />
            </div>
          )}

          {isReadOnlyCopy ? (
            <p className="text-muted-foreground text-xs">
              {t("settings.skills.importReadOnlyCopy")}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={writePending}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              {blocked
                ? t("settings.skills.skillDetailBack")
                : t("settings.skills.importCancel")}
            </Button>
            <Button
              disabled={blocked || !contentReady || writePending}
              onClick={() => {
                const now = Date.now();
                if (candidate.expiresAt <= now) {
                  setDeadlineNow(now);
                  return;
                }
                onConfirm();
              }}
              type="button"
            >
              {primaryLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
