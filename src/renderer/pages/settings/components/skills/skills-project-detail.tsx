import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { ItemGroup } from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { StatusStack } from "@pier/ui/status-stack.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  type ImportCandidateView,
  type SkillDetailTarget,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { buildSkillsProjectStatusItems } from "./build-skills-project-status-items.ts";
import { runRepair } from "./skills-apply-flow.ts";
import {
  filterManagedSkills,
  filterUnmanagedRows,
  filterUserGlobalRows,
} from "./skills-detail-filters.ts";
import { SkillsDetailHeader } from "./skills-detail-header.tsx";
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
import { useSkillsProjectDetailActions } from "./skills-project-detail-actions.ts";

const GIT_IGNORE_LINES = [".agents/skills/", ".claude/skills/"].join("\n");

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
  const sessionRefreshHint = useProjectSkillsStore((s) => s.sessionRefreshHint);
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

  const riskyGitStates = useMemo(
    () =>
      lastPlan?.gitStates?.filter(
        (entry) => entry.state === "tracked" || entry.state === "untracked"
      ) ?? [],
    [lastPlan]
  );

  const statusItems = useMemo(
    () =>
      buildSkillsProjectStatusItems({
        errorMessage,
        lastApplyOutcome,
        loadStatus,
        onCopyGitIgnore: () => {
          navigator.clipboard
            .writeText(GIT_IGNORE_LINES)
            .then(() => {
              toast.success(t("settings.skills.copySuccess"));
            })
            .catch(() => {
              showAppAlert({
                title: t("settings.skills.copyFailed"),
                body: t("settings.skills.copyFailed"),
              }).catch(() => undefined);
            });
        },
        onDismissSessionRefresh: () => {
          setSessionRefreshHint(false);
        },
        onReload: () => {
          handleReload().catch(() => undefined);
        },
        onRepair: () => {
          runRepair(t).catch(() => undefined);
        },
        onRetryOperation: () => {
          handleRetryOperation().catch(() => undefined);
        },
        reloadRequired,
        riskyGitStates,
        sessionRefreshHint,
        t,
        writesDisabled,
        writesFrozen,
      }),
    [
      errorMessage,
      handleReload,
      handleRetryOperation,
      lastApplyOutcome,
      loadStatus,
      reloadRequired,
      riskyGitStates,
      sessionRefreshHint,
      setSessionRefreshHint,
      t,
      writesDisabled,
      writesFrozen,
    ]
  );

  if (!projectRef) {
    return null;
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
          {statusItems.length > 0 ? (
            <StatusStack
              data-testid="skills-project-status-stack"
              dismissLabel={t("settings.skills.dismiss")}
              items={statusItems}
            />
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
