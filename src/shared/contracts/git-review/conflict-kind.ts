import type { GitReviewConflictXy } from "./primitives.ts";

export type GitReviewConflictTreeStatus = "added" | "deleted" | "modified";

export type GitReviewConflictFileActionIntent =
  | "confirm-delete"
  | "keep-current"
  | "keep-deleted"
  | "stage-current"
  | "take-incoming";

export interface GitReviewConflictFileAction {
  readonly action: "ours" | "stage" | "theirs";
  readonly destructive: boolean;
  readonly intent: GitReviewConflictFileActionIntent;
}

/** Pierre tree letter for an unmerged path: group already says “conflict”. */
export function gitReviewConflictTreeStatus(
  xy: GitReviewConflictXy
): GitReviewConflictTreeStatus {
  switch (xy) {
    case "AA":
    case "AU":
    case "UA":
      return "added";
    case "DD":
    case "DU":
      return "deleted";
    case "UD":
    case "UU":
      return "modified";
    default: {
      const exhaustive: never = xy;
      return exhaustive;
    }
  }
}

export function gitReviewConflictCanOpen(xy: GitReviewConflictXy): boolean {
  return xy !== "DD" && xy !== "DU";
}

/**
 * File-level resolution buttons, destructive first, constructive last.
 * `ours`/`theirs`/`stage` map to `git.resolveReviewConflict`; missing stage OID → `git rm`.
 */
export function gitReviewConflictFileActions(
  xy: GitReviewConflictXy
): readonly GitReviewConflictFileAction[] {
  switch (xy) {
    case "DD":
      return [{ action: "ours", destructive: true, intent: "confirm-delete" }];
    case "DU":
      return [
        { action: "ours", destructive: true, intent: "confirm-delete" },
        { action: "theirs", destructive: false, intent: "take-incoming" },
      ];
    case "UD":
      return [
        { action: "theirs", destructive: true, intent: "confirm-delete" },
        { action: "ours", destructive: false, intent: "keep-current" },
      ];
    case "AU":
      return [
        { action: "theirs", destructive: true, intent: "confirm-delete" },
        { action: "ours", destructive: false, intent: "keep-current" },
      ];
    case "UA":
      return [
        { action: "ours", destructive: true, intent: "keep-deleted" },
        { action: "theirs", destructive: false, intent: "take-incoming" },
      ];
    case "AA":
    case "UU":
      return [
        { action: "ours", destructive: false, intent: "keep-current" },
        { action: "theirs", destructive: false, intent: "take-incoming" },
        { action: "stage", destructive: false, intent: "stage-current" },
      ];
    default: {
      const exhaustive: never = xy;
      return exhaustive;
    }
  }
}
