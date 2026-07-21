import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type ImportCandidateView,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { SkillContentBody } from "./skills-readonly-detail.tsx";
import { formatBytes, type Translate } from "./skills-shared.tsx";

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
  const risk = candidate.riskSummary;
  const riskFrontmatterKeys = Object.keys(risk?.riskFrontmatter ?? {});
  const hasRisk =
    (risk?.executables.length ?? 0) > 0 ||
    (risk?.dynamicCommandTraces.length ?? 0) > 0 ||
    riskFrontmatterKeys.length > 0;
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

          {hasRisk ? (
            <Alert variant="warning">
              <AlertTitle>{t("settings.skills.riskTitle")}</AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-1">
                  {risk && risk.executables.length > 0 ? (
                    <span>
                      {t("settings.skills.riskExecutables", {
                        count: risk.executables.length,
                      })}
                    </span>
                  ) : null}
                  {risk && risk.dynamicCommandTraces.length > 0 ? (
                    <span>
                      {t("settings.skills.riskDynamic", {
                        count: risk.dynamicCommandTraces.length,
                      })}
                    </span>
                  ) : null}
                  {riskFrontmatterKeys.length > 0 ? (
                    <span>
                      {t("settings.skills.riskFrontmatter", {
                        keys: riskFrontmatterKeys.join(", "),
                      })}
                    </span>
                  ) : null}
                  <span>{t("settings.skills.riskDisclaimer")}</span>
                </span>
              </AlertDescription>
            </Alert>
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

          {conflict ? (
            <Alert variant="destructive">
              <AlertTitle>
                {t("settings.skills.conflictExists", {
                  id: candidate.skillId,
                })}
              </AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.conflictExistsBody")}
                  {onConflictResolve ? (
                    <span className="flex justify-end">
                      <Button
                        onClick={onConflictResolve}
                        size="sm"
                        type="button"
                      >
                        {t("settings.skills.reloadAndReturn")}
                      </Button>
                    </span>
                  ) : null}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          {reloadRequired && !conflict ? (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.skills.reloadRequired")}</AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.conflictReloadBody")}
                  {onConflictResolve ? (
                    <span className="flex justify-end">
                      <Button
                        onClick={onConflictResolve}
                        size="sm"
                        type="button"
                      >
                        {t("settings.skills.reloadAndReturn")}
                      </Button>
                    </span>
                  ) : null}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          {actionBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.skills.actionBlockedTitle")}</AlertTitle>
              <AlertDescription>
                {t("settings.skills.actionBlockedBody")}
              </AlertDescription>
            </Alert>
          ) : null}

          {expired ? (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.skills.importExpired")}</AlertTitle>
            </Alert>
          ) : null}

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
