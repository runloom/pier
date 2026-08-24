/**
 * Renderer-owned reading surfaces.
 *
 * The shared git contract still exposes the comparison baselines used by main.
 * The review UI projects the index document into separate conflict and
 * unstaged readers, plus staged and committed readers; `head` is not a UI
 * surface.
 */
export type GitReviewReadingSurface =
  | "conflict"
  | "index"
  | "staged"
  | "committed";

export type UncommittedGitReviewSurface = Extract<
  GitReviewReadingSurface,
  "conflict" | "index" | "staged"
>;

export interface GitReviewMutationLease {
  readonly minimumIndexGeneration: number;
}

export interface GitReviewMutationTransition {
  readonly anchorOffset?: number;
  readonly entryKey: string;
  readonly minimumIndexGeneration: number;
  readonly path: string;
  readonly sourceItemId?: string;
  readonly targetSurface: UncommittedGitReviewSurface;
}
