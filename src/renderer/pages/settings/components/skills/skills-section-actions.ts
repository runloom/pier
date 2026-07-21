import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  emptyDraft,
  type ImportCandidateView,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { commitSkillsIntent } from "./skills-apply-flow.ts";
import {
  discardPreparedCandidate,
  discardReviewCandidate,
} from "./skills-candidate-lifecycle.ts";
import { skillsErrorMessage } from "./skills-error-copy.ts";
import { confirmDiscardSkillEditDrafts } from "./skills-shared.tsx";

type ProjectSummary = ReturnType<
  typeof useProjectSkillsStore.getState
>["projects"][number];

export function useSkillsSectionActions(args: {
  adoptPending: boolean;
  adoptRequestRef: { current: number };
  loadProjects: (projectRootPath?: string) => Promise<unknown>;
  loadSnapshot: (projectRef: ProjectSummary["projectRef"]) => Promise<void>;
  projects: readonly ProjectSummary[];
  registerCandidate: (candidate: ImportCandidateView) => void;
  selectProject: (projectRef: ProjectSummary["projectRef"] | null) => void;
  setAdoptPending: (pending: boolean) => void;
  setDraft: (
    draft: import("@/stores/project-skills.store.ts").SkillsUiDraft | null
  ) => void;
  setMode: (
    mode: import("@/stores/project-skills.store.ts").SkillsViewMode
  ) => void;
  snapshot: ReturnType<typeof useProjectSkillsStore.getState>["snapshot"];
}) {
  const t = useT();
  const {
    adoptPending,
    adoptRequestRef,
    loadSnapshot,
    registerCandidate,
    selectProject,
    setAdoptPending,
    setDraft,
    setMode,
    snapshot,
  } = args;

  async function openProject(nextRef: ProjectSummary["projectRef"]) {
    const current = useProjectSkillsStore.getState().projectRef;
    if (current?.realPath === nextRef.realPath) {
      return;
    }
    if (!(await confirmDiscardSkillEditDrafts(t))) {
      return;
    }
    selectProject(nextRef);
    await loadSnapshot(nextRef);
    setDraft(null);
  }

  function reviewCandidate(candidate: ImportCandidateView) {
    useProjectSkillsStore.setState({ errorMessage: null });
    registerCandidate(candidate);
    setMode({ kind: "import-review", candidate });
  }

  async function cancelReview(candidate: ImportCandidateView) {
    await discardReviewCandidate(candidate);
    useProjectSkillsStore.setState({ errorMessage: null });
    setMode({ kind: "detail" });
  }

  async function commitCandidate(candidate: ImportCandidateView) {
    if (candidate.expiresAt <= Date.now()) {
      await showAppAlert({
        title: t("settings.skills.importExpired"),
        body: t("settings.skills.candidateExpiredBody"),
      });
      return;
    }
    const state = useProjectSkillsStore.getState();
    const delivery = state.snapshot?.manifest?.delivery;
    const intent = emptyDraft({
      agents: Boolean(delivery?.agents),
      claude: Boolean(delivery?.claude),
    });
    intent.importTokens = [candidate.token];
    const result = await commitSkillsIntent({
      draft: intent,
      t,
    });
    if (result === "converged" || result === "degraded") {
      state.removeCandidate(candidate.token);
      setMode({ kind: "detail" });
    }
  }

  /** Resolve a read-only detail target against the current snapshot. */
  function resolveReadonlyTarget(
    target:
      | { kind: "project"; root: string; directoryName: string }
      | { kind: "user-global"; root: string; directoryName: string }
  ):
    | {
        kind: "project";
        entry: NonNullable<typeof snapshot>["unmanagedSkills"][number];
      }
    | {
        kind: "user-global";
        entry: NonNullable<typeof snapshot>["userGlobalSkills"][number];
      }
    | null {
    if (!snapshot) return null;
    if (target.kind === "project") {
      const entry = snapshot.unmanagedSkills.find(
        (item) =>
          item.root === target.root &&
          item.directoryName === target.directoryName
      );
      return entry ? { kind: "project", entry } : null;
    }
    const entry = snapshot.userGlobalSkills.find(
      (item) =>
        item.root === target.root && item.directoryName === target.directoryName
    );
    return entry ? { kind: "user-global", entry } : null;
  }

  /** Adoption from the read-only detail (design v8 §7.5). */
  async function adoptUnmanaged(entry: {
    root: string;
    directoryName: string;
  }) {
    const state = useProjectSkillsStore.getState();
    if (!state.projectRef || adoptPending) return;
    const requestId = adoptRequestRef.current + 1;
    adoptRequestRef.current = requestId;
    const requestProject = state.projectRef;
    setAdoptPending(true);
    try {
      const candidate =
        await window.pier.projectSkills.importPrepareFromDiscovery(
          requestProject,
          `${entry.root}/${entry.directoryName}`
        );
      const latestMode = useProjectSkillsStore.getState().mode;
      const requestIsCurrent =
        adoptRequestRef.current === requestId &&
        useProjectSkillsStore.getState().projectRef?.realPath ===
          requestProject.realPath &&
        latestMode.kind === "skill-detail" &&
        latestMode.target.kind === "project" &&
        latestMode.target.root === entry.root &&
        latestMode.target.directoryName === entry.directoryName;
      if (
        requestIsCurrent &&
        candidate &&
        typeof candidate === "object" &&
        "token" in (candidate as Record<string, unknown>)
      ) {
        reviewCandidate(candidate as ImportCandidateView);
      } else if (candidate) {
        await discardPreparedCandidate(requestProject, candidate);
      }
    } catch (error) {
      if (adoptRequestRef.current === requestId) {
        await showAppAlert({
          title: t("settings.skills.importFailed"),
          body: skillsErrorMessage(
            error,
            t,
            "settings.skills.importFailedBody"
          ),
        });
      }
    } finally {
      if (adoptRequestRef.current === requestId) {
        setAdoptPending(false);
      }
    }
  }

  return {
    openProject,
    reviewCandidate,
    cancelReview,
    commitCandidate,
    adoptUnmanaged,
    resolveReadonlyTarget,
  };
}
