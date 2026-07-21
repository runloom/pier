import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import {
  type ImportCandidateView,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";

export async function discardPreparedCandidate(
  projectRef: ProjectRootRef,
  candidate: unknown
): Promise<void> {
  if (!(candidate && typeof candidate === "object")) return;
  const token = (candidate as Record<string, unknown>).token;
  if (typeof token !== "string" || token.length === 0) return;
  try {
    await window.pier.projectSkills.importDiscard(projectRef, token);
  } catch {
    // Candidate TTL cleanup remains the fallback if best-effort discard fails.
  }
}

/** Idempotent discard of a candidate that only lives on the review page. */
export async function discardReviewCandidate(
  candidate: ImportCandidateView
): Promise<void> {
  const state = useProjectSkillsStore.getState();
  if (state.projectRef && candidate.token) {
    await discardPreparedCandidate(state.projectRef, candidate);
  }
  state.removeCandidate(candidate.token);
}

/**
 * Clear import-review + discard staging when leaving the skills workspace
 * (§7.7). Does not prompt for editor drafts — callers must confirm those first.
 */
export async function discardActiveImportReview(): Promise<void> {
  const state = useProjectSkillsStore.getState();
  if (state.mode.kind !== "import-review") {
    return;
  }
  await discardReviewCandidate(state.mode.candidate);
  state.setMode({ kind: "detail" });
}
