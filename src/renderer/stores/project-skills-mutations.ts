import type {
  ApplyResult,
  ProjectRootRef,
  ProjectSkillsAcknowledgement,
} from "@shared/contracts/project-skills.ts";

import {
  draftFingerprint,
  isPlanPayload,
  normalizeConfirmation,
  normalizeIssue,
  type PlanConfirmationView,
  type PlanIssueView,
  type ProjectSkillsPlanView,
  type SkillsUiDraft,
} from "./project-skills-model.ts";

/** Minimal store surface used by plan / apply / poll helpers. */
export interface ProjectSkillsMutationApi {
  applyPending: boolean;
  candidatesByToken: Record<string, unknown>;
  draft: SkillsUiDraft | null;
  draftGeneration: number;
  errorMessage: string | null;
  lastApplyOperationId: string | null;
  lastApplyOutcome: "converged" | "degraded" | null;
  lastPlan: ProjectSkillsPlanView | null;
  loadSnapshot: (projectRef: ProjectRootRef) => Promise<void>;
  observedRevision: string | null;
  pendingOperationId: string | null;
  planPending: boolean;
  planRequestId: number;
  projectRef: ProjectRootRef | null;
  reloadRequired: boolean;
  setDraft: (draft: SkillsUiDraft | null) => void;
  writesFrozen: boolean;
}

type Get = () => ProjectSkillsMutationApi;
// Zustand setState accepts extra fields on the real store; keep this loose.
type Set = (partial: Record<string, unknown>) => void;

export async function runPlanDraft(get: Get, set: Set) {
  const state = get();
  if (!(state.projectRef && state.draft && state.observedRevision)) {
    return null;
  }
  if (state.reloadRequired || state.writesFrozen) {
    return null;
  }
  const requestId = state.planRequestId + 1;
  const generation = state.draftGeneration;
  const fingerprint = draftFingerprint(state.draft);
  set({ errorMessage: null, planPending: true, planRequestId: requestId });
  try {
    const planRaw = await window.pier.projectSkills.plan(
      state.projectRef,
      state.observedRevision,
      state.draft
    );
    const latest = get();
    if (
      latest.planRequestId !== requestId ||
      latest.draftGeneration !== generation
    ) {
      return null;
    }
    if (!isPlanPayload(planRaw)) {
      set({
        lastPlan: null,
        planPending: false,
      });
      return null;
    }
    const view: ProjectSkillsPlanView = {
      applicable: Boolean(planRaw.applicable),
      blockingIssues: (planRaw.blockingIssues ?? [])
        .map(normalizeIssue)
        .filter((issue): issue is PlanIssueView => issue !== null),
      confirmationRequirements: (planRaw.confirmationRequirements ?? [])
        .map(normalizeConfirmation)
        .filter((req): req is PlanConfirmationView => req !== null),
      draftFingerprint: fingerprint,
      gitStates: (planRaw.gitStates ?? []).flatMap((value) => {
        if (!(value && typeof value === "object")) return [];
        const record = value as Record<string, unknown>;
        const state = record.state;
        if (
          typeof record.relativeTarget !== "string" ||
          (state !== "absent" &&
            state !== "ignored" &&
            state !== "untracked" &&
            state !== "tracked" &&
            state !== "unknown")
        ) {
          return [];
        }
        return [{ relativeTarget: record.relativeTarget, state }];
      }),
      observedRevision: planRaw.observedRevision ?? state.observedRevision,
      planDigest: planRaw.planDigest ?? "",
    };
    set({ lastPlan: view, planPending: false });
    return view;
  } catch {
    if (get().planRequestId === requestId) {
      // Background planning must not paint the page as a hard failure.
      set({
        lastPlan: null,
        planPending: false,
      });
    }
    return null;
  }
}

export async function runApply(
  get: Get,
  set: Set,
  operationId: string,
  acknowledgements: readonly ProjectSkillsAcknowledgement[] = []
): Promise<ApplyResult | null> {
  const state = get();
  if (
    !(
      state.projectRef &&
      state.draft &&
      state.observedRevision &&
      state.lastPlan
    ) ||
    state.reloadRequired ||
    state.writesFrozen ||
    state.applyPending
  ) {
    return null;
  }
  const fingerprint = draftFingerprint(state.draft);
  if (state.lastPlan.draftFingerprint !== fingerprint) {
    set({ errorMessage: "plan-stale" });
    return null;
  }
  set({
    applyPending: true,
    errorMessage: null,
    lastApplyOperationId: operationId,
  });
  try {
    const result = await window.pier.projectSkills.apply({
      acknowledgements,
      draft: state.draft,
      observedRevision: state.observedRevision,
      operationId,
      planDigest: state.lastPlan.planDigest,
      projectRef: state.projectRef,
    });
    if (get().lastApplyOperationId !== operationId) {
      return result;
    }
    if (result.status === "converged" || result.status === "degraded") {
      const revisions = (
        result as {
          revisions?: { observedRevision?: string };
        }
      ).revisions;
      set({
        applyPending: false,
        draft: null,
        draftGeneration: get().draftGeneration + 1,
        candidatesByToken: {},
        lastApplyOutcome: result.status,
        lastPlan: null,
        observedRevision: revisions?.observedRevision ?? state.observedRevision,
        reloadRequired: false,
      });
    } else if (result.status === "indeterminate") {
      // Freeze all writes and poll the operation until it settles into an
      // immutable terminal state (design v8 §7.7).
      set({
        applyPending: false,
        writesFrozen: true,
        pendingOperationId: result.operationId,
      });
    } else {
      set({ applyPending: false });
    }
    return result;
  } catch (error) {
    if (get().lastApplyOperationId === operationId) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict =
        message.startsWith("revision-conflict") ||
        message.startsWith("plan-stale") ||
        message.startsWith("content-conflict") ||
        message.includes("revision-conflict:") ||
        message.includes("plan-stale:") ||
        message.includes("content-conflict:");
      set({
        applyPending: false,
        errorMessage: message,
        ...(conflict ? { reloadRequired: true } : {}),
      });
    }
    return null;
  }
}

export async function runPollOperation(get: Get, set: Set): Promise<void> {
  const state = get();
  if (!(state.writesFrozen && state.pendingOperationId && state.projectRef)) {
    return;
  }
  try {
    const status = (await window.pier.projectSkills.operationStatus(
      state.projectRef,
      state.pendingOperationId
    )) as { kind?: string; status?: string } | null;
    const settled =
      status?.kind === "terminal" ||
      (typeof status?.status === "string" &&
        status.status !== "pending" &&
        status.status !== "recovering");
    if (settled) {
      // Surface every terminal outcome: success refreshes the disk truth,
      // degraded offers repair, and a non-apply keeps the intent available
      // while showing a retryable localized error.
      const terminalStatus = status?.status;
      set({
        errorMessage: null,
        writesFrozen: false,
        pendingOperationId: null,
        ...(terminalStatus === "converged" || terminalStatus === "degraded"
          ? { lastApplyOutcome: terminalStatus }
          : {}),
      });
      const ref = get().projectRef;
      if (ref) {
        await get().loadSnapshot(ref);
      }
      if (terminalStatus === "converged" || terminalStatus === "degraded") {
        get().setDraft(null);
      } else {
        set({
          errorMessage: "operation-not-applied",
          lastPlan: null,
          reloadRequired: false,
        });
      }
    }
  } catch {
    // Keep frozen; the next poll retries.
  }
}
