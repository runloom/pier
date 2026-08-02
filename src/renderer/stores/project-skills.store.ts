import type {
  ApplyResult,
  ProjectRootRef,
  ProjectSkillsAcknowledgement,
} from "@shared/contracts/project-skills.ts";
import { create } from "zustand";

import {
  runApply,
  runPlanDraft,
  runPollOperation,
} from "./project-skills-mutations.ts";

export {
  draftFingerprint,
  draftIsDirty,
  emptyDraft,
  type ImportCandidateView,
  normalizeConfirmation,
  type PlanConfirmationView,
  type PlanIssueView,
  type ProjectSkillsPlanView,
  type ProjectSkillsProjectSummary,
  type ProjectSkillsSnapshotView,
  type SkillDetailTarget,
  type SkillsUiDraft,
  type SkillsViewMode,
} from "./project-skills-model.ts";

import {
  draftIsDirty,
  emptyDraft,
  type ImportCandidateView,
  isProjectRootRef,
  isProjectSummary,
  normalizeSnapshot,
  type ProjectSkillsPlanView,
  type ProjectSkillsProjectSummary,
  type ProjectSkillsSnapshotView,
  type SkillsUiDraft,
  type SkillsViewMode,
} from "./project-skills-model.ts";

type LoadStatus = "idle" | "loading" | "ready" | "error";

export type ApplyOutcome =
  | "converged"
  | "degraded"
  | "indeterminate"
  | "failed"
  | "cancelled";

interface ProjectSkillsState {
  apply: (
    operationId: string,
    acknowledgements?: readonly ProjectSkillsAcknowledgement[]
  ) => Promise<ApplyResult | null>;
  applyPending: boolean;
  /** Candidate metadata by token — change list & confirmations display. */
  candidatesByToken: Record<string, ImportCandidateView>;
  discardDraft: () => void;
  draft: SkillsUiDraft | null;
  draftGeneration: number;
  /** Local edit drafts per skill (design v8 §7.4 — never lose typed text). */
  editDraftBySkillId: Record<string, string>;
  errorMessage: string | null;
  lastApplyOperationId: string | null;
  /** Last terminal apply outcome — drives the "check and repair" primary. */
  lastApplyOutcome: "converged" | "degraded" | null;
  lastPlan: ProjectSkillsPlanView | null;
  loadProjects: (projectRootPath?: string) => Promise<ProjectRootRef | null>;
  loadSnapshot: (
    projectRef: ProjectRootRef,
    options?: { quiet?: boolean }
  ) => Promise<void>;
  loadStatus: LoadStatus;
  markReloadRequired: (observedRevision?: string) => void;
  mode: SkillsViewMode;
  observedRevision: string | null;
  pendingFocusIssueIds: string[];
  /** Deep-link target (design v8 §7.1 pier.skills.open equivalent). */
  pendingOpenProjectPath: string | null;
  pendingOperationId: string | null;
  planDraft: () => Promise<ProjectSkillsPlanView | null>;
  planPending: boolean;
  /** Per-command request sequencing (design v8 §7.7). */
  planRequestId: number;
  pollOperation: () => Promise<void>;
  projectRef: ProjectRootRef | null;
  projects: ProjectSkillsProjectSummary[];
  projectsRequestId: number;
  registerCandidate: (candidate: ImportCandidateView) => void;
  reloadRequired: boolean;
  removeCandidate: (token: string) => void;
  requestOpenProject: (
    projectRootPath: string,
    focusIssueIds?: readonly string[]
  ) => void;
  reset: () => void;
  selectProject: (
    projectRef: ProjectRootRef | null,
    preservePendingFocus?: boolean
  ) => void;
  /** Soft tip after discovery-changing applies (§1.2). */
  sessionRefreshHint: boolean;
  setDraft: (draft: SkillsUiDraft | null) => void;
  setEditDraft: (skillId: string, text: string | null) => void;
  setMode: (mode: SkillsViewMode) => void;
  setSessionRefreshHint: (show: boolean) => void;
  snapshot: ProjectSkillsSnapshotView | null;
  snapshotRequestId: number;
  updateDraft: (patch: Partial<SkillsUiDraft>) => void;
  /** Frozen while an indeterminate operation is being resolved. */
  writesFrozen: boolean;
}

const initialState = {
  mode: { kind: "projects" } as SkillsViewMode,
  lastApplyOutcome: null as "converged" | "degraded" | null,
  editDraftBySkillId: {} as Record<string, string>,
  pendingOpenProjectPath: null as string | null,
  pendingFocusIssueIds: [] as string[],
  applyPending: false,
  writesFrozen: false,
  pendingOperationId: null as string | null,
  draft: null as SkillsUiDraft | null,
  draftGeneration: 0,
  candidatesByToken: {} as Record<string, ImportCandidateView>,
  errorMessage: null as string | null,
  lastApplyOperationId: null as string | null,
  lastPlan: null as ProjectSkillsPlanView | null,
  loadStatus: "loading" as LoadStatus,
  observedRevision: null as string | null,
  planPending: false,
  planRequestId: 0,
  snapshotRequestId: 0,
  projectRef: null as ProjectRootRef | null,
  projects: [] as ProjectSkillsProjectSummary[],
  projectsRequestId: 0,
  reloadRequired: false,
  sessionRefreshHint: false,
  snapshot: null as ProjectSkillsSnapshotView | null,
};

function sameProjectRef(
  left: ProjectRootRef | null,
  right: ProjectRootRef
): boolean {
  return (
    left?.realPath === right.realPath &&
    left.volumeIdentity === right.volumeIdentity &&
    left.directoryIdentity === right.directoryIdentity
  );
}

export const useProjectSkillsStore = create<ProjectSkillsState>((set, get) => ({
  ...initialState,

  reset() {
    set({ ...initialState });
  },

  setMode(mode) {
    set({ mode });
  },

  setEditDraft(skillId, text) {
    set((state) => {
      const next = { ...state.editDraftBySkillId };
      if (text === null) {
        delete next[skillId];
      } else {
        next[skillId] = text;
      }
      return { editDraftBySkillId: next };
    });
  },

  requestOpenProject(projectRootPath, focusIssueIds = []) {
    set({
      pendingOpenProjectPath: projectRootPath,
      pendingFocusIssueIds: [...focusIssueIds],
    });
  },

  selectProject(projectRef, preservePendingFocus = false) {
    set((state) => ({
      draft: null,
      draftGeneration: 0,
      candidatesByToken: {},
      editDraftBySkillId: {},
      errorMessage: null,
      lastApplyOperationId: null,
      lastPlan: null,
      observedRevision: null,
      pendingOperationId: null,
      ...(preservePendingFocus ? {} : { pendingFocusIssueIds: [] }),
      writesFrozen: false,
      projectRef,
      reloadRequired: false,
      sessionRefreshHint: false,
      snapshot: null,
      // Selecting a project clears the snapshot — mark loading so the detail
      // shell does not flash the empty state before loadSnapshot runs.
      loadStatus: projectRef ? "loading" : state.loadStatus,
      snapshotRequestId: state.snapshotRequestId + 1,
      mode: projectRef ? { kind: "detail" } : { kind: "projects" },
    }));
  },

  setSessionRefreshHint(show) {
    set({ sessionRefreshHint: show });
  },

  setDraft(draft) {
    set((state) => ({
      draft,
      draftGeneration: state.draftGeneration + 1,
      lastPlan: null,
      reloadRequired: false,
    }));
  },

  updateDraft(patch) {
    const delivery = get().snapshot?.manifest?.delivery;
    const current =
      get().draft ??
      emptyDraft({
        agents: Boolean(delivery?.agents),
        claude: Boolean(delivery?.claude),
      });
    get().setDraft({ ...current, ...patch });
  },

  discardDraft() {
    const snapshot = get().snapshot;
    const delivery = snapshot?.manifest?.delivery;
    set({
      draft: emptyDraft({
        agents: Boolean(delivery?.agents),
        claude: Boolean(delivery?.claude),
      }),
      draftGeneration: get().draftGeneration + 1,
      candidatesByToken: {},
      lastPlan: null,
      reloadRequired: false,
    });
  },

  registerCandidate(candidate) {
    set((state) => ({
      candidatesByToken: {
        ...state.candidatesByToken,
        [candidate.token]: candidate,
      },
    }));
  },

  removeCandidate(token) {
    set((state) => {
      const next = { ...state.candidatesByToken };
      delete next[token];
      return { candidatesByToken: next };
    });
  },

  markReloadRequired(observedRevision) {
    set((state) => {
      const dirty = draftIsDirty(state.draft, state.snapshot);
      return {
        observedRevision: observedRevision ?? state.observedRevision,
        reloadRequired: dirty,
        lastPlan: dirty ? null : state.lastPlan,
      };
    });
  },

  async loadProjects(projectRootPath) {
    const requestId = get().projectsRequestId + 1;
    set({
      errorMessage: null,
      loadStatus: "loading",
      projectsRequestId: requestId,
    });
    try {
      const projects =
        await window.pier.projectSkills.projectsSnapshot(projectRootPath);
      const list = Array.isArray(projects)
        ? projects.filter(isProjectSummary)
        : [];
      if (get().projectsRequestId !== requestId) {
        return null;
      }
      set({
        loadStatus: "ready",
        projects: list,
      });
      return projectRootPath ? (list[0]?.projectRef ?? null) : null;
    } catch (error) {
      if (get().projectsRequestId !== requestId) {
        return null;
      }
      set({
        errorMessage: error instanceof Error ? error.message : String(error),
        loadStatus: "error",
      });
      return null;
    }
  },

  async loadSnapshot(projectRef, options) {
    const requestId = get().snapshotRequestId + 1;
    // Quiet refresh keeps the current list painted; only first loads show skeletons.
    const quiet = Boolean(options?.quiet && get().snapshot);
    set({
      errorMessage: null,
      ...(quiet ? {} : { loadStatus: "loading" as const }),
      projectRef,
      snapshotRequestId: requestId,
    });
    try {
      const raw = await window.pier.projectSkills.snapshot(projectRef);
      if (
        get().snapshotRequestId !== requestId ||
        !sameProjectRef(get().projectRef, projectRef)
      ) {
        return; // Late response — a newer snapshot request superseded us.
      }
      const snapshot = normalizeSnapshot(raw);
      const observedRevision = snapshot?.observedRevision ?? null;
      const resolvedRef =
        snapshot && isProjectRootRef(snapshot.projectRef)
          ? snapshot.projectRef
          : projectRef;
      set((state) => {
        const dirty = draftIsDirty(state.draft, snapshot);
        return {
          loadStatus: snapshot ? "ready" : "error",
          observedRevision,
          projectRef: resolvedRef,
          reloadRequired: dirty,
          snapshot,
          lastPlan: dirty ? null : state.lastPlan,
          ...(snapshot
            ? { errorMessage: null }
            : {
                errorMessage: "Invalid skills snapshot",
              }),
        };
      });
    } catch (error) {
      if (
        get().snapshotRequestId !== requestId ||
        !sameProjectRef(get().projectRef, projectRef)
      ) {
        return;
      }
      set({
        errorMessage: error instanceof Error ? error.message : String(error),
        loadStatus: "error",
      });
    }
  },

  async planDraft() {
    return await runPlanDraft(get, set);
  },

  async apply(operationId, acknowledgements = []) {
    return await runApply(get, set, operationId, acknowledgements);
  },

  async pollOperation() {
    await runPollOperation(get, set);
  },
}));
