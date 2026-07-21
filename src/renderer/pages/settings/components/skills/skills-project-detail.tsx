import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { ItemGroup } from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  type ImportCandidateView,
  type SkillDetailTarget,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { runRepair } from "./skills-apply-flow.ts";
import {
  filterManagedSkills,
  filterUnmanagedRows,
  filterUserGlobalRows,
} from "./skills-detail-filters.ts";
import {
  SkillsDetailBanner,
  SkillsDetailHeader,
} from "./skills-detail-header.tsx";
import {
  ManagedSkillRow,
  UnmanagedSkillRow,
  UserGlobalSkillRow,
} from "./skills-detail-rows.tsx";
import {
  SkillsEmptyState,
  type SkillsFilterId,
  SkillsListToolbar,
  SkillsNoResults,
} from "./skills-detail-toolbar.tsx";
import { skillsErrorMessage } from "./skills-error-copy.ts";
import { useSkillsProjectDetailActions } from "./skills-project-detail-actions.ts";

export function SkillsProjectDetail({
  activeProjectRootPath,
  focusSkillId,
  hideBack = false,
  onBack,
  onOpenSkill,
  onReviewCandidate,
}: {
  activeProjectRootPath: string | null;
  focusSkillId?: string;
  /** When embedded in Projects shell, the shell owns the back control. */
  hideBack?: boolean;
  onBack: () => void;
  onOpenSkill: (target: SkillDetailTarget) => void;
  onReviewCandidate: (candidate: ImportCandidateView) => void;
}) {
  const t = useT();
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const snapshot = useProjectSkillsStore((s) => s.snapshot);
  const reloadRequired = useProjectSkillsStore((s) => s.reloadRequired);
  const applyPending = useProjectSkillsStore((s) => s.applyPending);
  const planPending = useProjectSkillsStore((s) => s.planPending);
  const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
  const loadStatus = useProjectSkillsStore((s) => s.loadStatus);
  const errorMessage = useProjectSkillsStore((s) => s.errorMessage);
  const retryDraft = useProjectSkillsStore((s) =>
    s.errorMessage === "operation-not-applied" ? s.draft : null
  );
  const lastApplyOutcome = useProjectSkillsStore((s) => s.lastApplyOutcome);
  const recentImportNotice = useProjectSkillsStore((s) => s.recentImportNotice);
  const sessionRefreshHint = useProjectSkillsStore((s) => s.sessionRefreshHint);
  const setRecentImportNotice = useProjectSkillsStore(
    (s) => s.setRecentImportNotice
  );
  const setSessionRefreshHint = useProjectSkillsStore(
    (s) => s.setSessionRefreshHint
  );
  const lastPlan = useProjectSkillsStore((s) => s.lastPlan);

  const [filter, setFilter] = useState<SkillsFilterId>("all");
  const [query, setQuery] = useState("");
  const [preparePending, setPreparePending] = useState(false);
  const prepareMountedRef = useRef(true);
  const prepareRequestRef = useRef(0);

  useEffect(() => {
    prepareMountedRef.current = true;
    return () => {
      prepareMountedRef.current = false;
      prepareRequestRef.current += 1;
    };
  }, []);

  const writesDisabled =
    writesFrozen || reloadRequired || planPending || applyPending;

  useEffect(() => {
    if (!focusSkillId) return;
    setFilter("all");
    setQuery("");
  }, [focusSkillId]);

  const skills = snapshot?.skills ?? [];
  const unmanaged = snapshot?.unmanagedSkills ?? [];
  const userGlobal = snapshot?.userGlobalSkills ?? [];

  const filteredSkills = useMemo(
    () => filterManagedSkills({ skills, filter, query }),
    [filter, query, skills]
  );

  const filteredUnmanaged = useMemo(
    () => filterUnmanagedRows({ entries: unmanaged, filter, query }),
    [filter, query, unmanaged]
  );

  const filteredUserGlobal = useMemo(
    () => filterUserGlobalRows({ entries: userGlobal, filter, query }),
    [filter, query, userGlobal]
  );

  const totalCount = skills.length + unmanaged.length + userGlobal.length;
  const shownCount =
    filteredSkills.length +
    filteredUnmanaged.length +
    filteredUserGlobal.length;

  const {
    handleImportFolder,
    handleReload,
    handleRetryOperation,
    handleToggle,
  } = useSkillsProjectDetailActions({
    onReviewCandidate,
    preparePending,
    prepareRequestRef,
    projectRef,
    retryDraft,
    setPreparePending,
    snapshot,
    writesDisabled,
  });

  if (!projectRef) {
    return null;
  }

  const riskyGitStates =
    lastPlan?.gitStates?.filter(
      (entry) => entry.state === "tracked" || entry.state === "untracked"
    ) ?? [];

  let bannerVariant: "default" | "warning" | "destructive" = "destructive";
  let bannerTitle = t("settings.skills.loadFailed");
  if (writesFrozen) {
    bannerVariant = "default";
    bannerTitle = t("settings.skills.applyIndeterminate");
  } else if (reloadRequired) {
    bannerVariant = "warning";
    bannerTitle = t("settings.skills.reloadRequired");
  }
  let bannerBody: string | null = errorMessage
    ? skillsErrorMessage(
        errorMessage,
        t,
        loadStatus === "error"
          ? "settings.skills.loadFailedBody"
          : "settings.skills.actionFailedBody"
      )
    : t("settings.skills.reloadRequiredHint");
  if (writesFrozen) {
    bannerBody = null;
  } else if (errorMessage === "operation-not-applied") {
    bannerBody = t("settings.skills.operationNotApplied");
  }
  let bannerActionLabel: string | undefined = t("settings.skills.reload");
  if (writesFrozen) {
    bannerActionLabel = undefined;
  } else if (errorMessage === "operation-not-applied") {
    bannerActionLabel = t("settings.skills.retry");
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SkillsDetailHeader
        activeProjectRootPath={activeProjectRootPath}
        addDisabled={writesDisabled || preparePending}
        hideBack={hideBack}
        onBack={onBack}
        projectRef={projectRef}
        t={t}
      />

      <Card
        aria-busy={planPending || applyPending}
        className="overflow-visible border border-border shadow-none ring-0"
      >
        <CardHeader>
          <CardTitle>
            {t("settings.skills.listTitle", { count: totalCount })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recentImportNotice ? (
            <Alert>
              <AlertTitle>
                {t("settings.skills.importAddedTitle", {
                  name: recentImportNotice.name,
                })}
              </AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.importAddedBody")}
                  <span className="flex justify-end">
                    <Button
                      onClick={() => {
                        setRecentImportNotice(null);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t("settings.skills.dismiss")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {sessionRefreshHint ? (
            <Alert>
              <AlertTitle>
                {t("settings.skills.sessionRefreshTitle")}
              </AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.sessionRefreshBody")}
                  <span className="flex justify-end">
                    <Button
                      onClick={() => {
                        setSessionRefreshHint(false);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t("settings.skills.dismiss")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {riskyGitStates.length > 0 ? (
            <Alert>
              <AlertTitle>{t("settings.skills.gitStatusTitle")}</AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-1 text-sm">
                    {riskyGitStates.map((entry) => (
                      <li key={entry.relativeTarget}>
                        <span className="font-mono">
                          {entry.relativeTarget}
                        </span>
                        {" · "}
                        {t(`settings.skills.gitState.${entry.state}`)}
                      </li>
                    ))}
                  </ul>
                  <p>{t("settings.skills.gitIgnoreHint")}</p>
                  <span className="flex justify-end">
                    <Button
                      onClick={() => {
                        const text = [
                          ".agents/skills/",
                          ".claude/skills/",
                        ].join("\n");
                        navigator.clipboard
                          .writeText(text)
                          .then(() => {
                            toast.success(t("settings.skills.copySuccess"));
                          })
                          .catch(() => {
                            showAppAlert({
                              title: t("settings.skills.copyFailed"),
                              body: t("settings.skills.copyFailed"),
                            }).catch(() => undefined);
                          });
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t("settings.skills.copyGitIgnore")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {reloadRequired || writesFrozen || errorMessage ? (
            <SkillsDetailBanner
              {...(bannerActionLabel === undefined
                ? {}
                : { actionLabel: bannerActionLabel })}
              body={bannerBody}
              onAction={() => {
                if (errorMessage === "operation-not-applied") {
                  handleRetryOperation().catch(() => undefined);
                } else {
                  handleReload().catch(() => undefined);
                }
              }}
              title={bannerTitle}
              variant={bannerVariant}
            />
          ) : null}
          {lastApplyOutcome === "degraded" ? (
            <Alert variant="warning">
              <AlertTitle>
                {t("settings.skills.projectionIncomplete")}
              </AlertTitle>
              <AlertDescription>
                <span className="flex flex-col gap-2">
                  {t("settings.skills.projectionIncompleteBody")}
                  <span className="flex justify-end">
                    <Button
                      disabled={writesDisabled}
                      onClick={() => {
                        runRepair(t).catch(() => undefined);
                      }}
                      size="sm"
                      type="button"
                    >
                      {t("settings.skills.retry")}
                    </Button>
                  </span>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          <SkillsListToolbar
            filter={filter}
            onFilterChange={setFilter}
            onQueryChange={setQuery}
            query={query}
            shownCount={shownCount}
            t={t}
            totalCount={totalCount}
          />

          {loadStatus === "loading" && !snapshot ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : null}

          {shownCount === 0 &&
          loadStatus !== "loading" &&
          (query || filter !== "all") ? (
            <SkillsNoResults
              onClearFilters={() => {
                setQuery("");
                setFilter("all");
              }}
              t={t}
            />
          ) : null}
          {shownCount === 0 &&
          loadStatus !== "loading" &&
          !query &&
          filter === "all" ? (
            <SkillsEmptyState
              onImportFolder={() => {
                handleImportFolder().catch(() => undefined);
              }}
              t={t}
            />
          ) : null}
          {shownCount > 0 || loadStatus === "loading" ? (
            <ItemGroup>
              {filteredSkills.map((skill) => (
                <ManagedSkillRow
                  disabled={writesDisabled}
                  enabled={skill.enabled}
                  key={skill.id}
                  onOpenSkill={(skillId) => {
                    onOpenSkill({ kind: "managed", skillId });
                  }}
                  onToggle={(skillId, checked) => {
                    handleToggle(skillId, checked).catch(() => undefined);
                  }}
                  skill={skill}
                  t={t}
                />
              ))}
              {filteredUnmanaged.map((entry) => (
                <UnmanagedSkillRow
                  entry={entry}
                  key={`${entry.root}/${entry.directoryName}`}
                  onView={(target) => {
                    onOpenSkill({
                      kind: "project",
                      root: target.root,
                      directoryName: target.directoryName,
                    });
                  }}
                  t={t}
                />
              ))}
              {filteredUserGlobal.map((entry) => (
                <UserGlobalSkillRow
                  entry={entry}
                  key={`${entry.root}/${entry.directoryName}`}
                  onView={(target) => {
                    onOpenSkill({
                      kind: "user-global",
                      root: target.root,
                      directoryName: target.directoryName,
                    });
                  }}
                  t={t}
                />
              ))}
            </ItemGroup>
          ) : null}

          {/* Delivery targets live under Projects → General. */}
        </CardContent>
      </Card>
    </div>
  );
}
