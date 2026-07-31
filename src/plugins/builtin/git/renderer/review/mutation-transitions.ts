import type { GitReviewMutationTransition } from "./reading-surface.ts";

export interface ScopedGitReviewMutationTransition
  extends Omit<
    GitReviewMutationTransition,
    "entryKey" | "minimumIndexGeneration"
  > {
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly transitionId: string;
}

export type ScopedGitReviewMutationTransitionEvent =
  | {
      readonly kind: "begin";
      readonly transition: ScopedGitReviewMutationTransition;
    }
  | {
      readonly kind: "cancel";
      readonly transitionId: string;
    }
  | {
      readonly kind: "commit";
      readonly stateSequence?: number;
      readonly transitionId: string;
    };

type Listener = (event: ScopedGitReviewMutationTransitionEvent) => void;

const listeners = new Set<Listener>();

export function beginGitReviewMutationTransition(
  transition: ScopedGitReviewMutationTransition
): void {
  emit({ kind: "begin", transition });
}

export function cancelGitReviewMutationTransition(transitionId: string): void {
  emit({ kind: "cancel", transitionId });
}

export function commitGitReviewMutationTransition(
  transitionId: string,
  stateSequence?: number
): void {
  emit({
    kind: "commit",
    ...(stateSequence === undefined ? {} : { stateSequence }),
    transitionId,
  });
}

function emit(event: ScopedGitReviewMutationTransitionEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeGitReviewMutationTransition(
  listener: Listener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
