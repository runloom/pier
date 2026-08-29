import type { GitFileStatus, GitStatus } from "@shared/contracts/git.ts";
import { canPublishBranch } from "../remote-sync-policy.ts";

/** Porcelain conflict XY codes; same skip list as `deriveCounts`. */
const CONFLICT_XY_RE = /^(?:DD|AU|UD|UA|DU|AA|UU)$/u;

export type GitCommitPushAction = "publish" | "push";

export interface GitCommitPushAfter {
  readonly action: GitCommitPushAction | null;
  readonly disabledReason: "auth" | "unavailable" | null;
  readonly visible: boolean;
}

function isConflictFile(file: GitFileStatus): boolean {
  return CONFLICT_XY_RE.test(`${file.index}${file.worktree}`);
}

function isUntracked(file: GitFileStatus): boolean {
  return file.index === "?" && file.worktree === "?";
}

/**
 * Paths to stage when "include unstaged" is on.
 * Untracked (`??`) + tracked files whose worktree is not `.`.
 * Skips conflict XY. Includes `origPath` for renames.
 */
export function unstagedPathsFromStatus(
  files: readonly GitFileStatus[]
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const push = (path: string): void => {
    if (path.length === 0 || seen.has(path)) {
      return;
    }
    seen.add(path);
    paths.push(path);
  };
  for (const file of files) {
    if (isConflictFile(file)) {
      continue;
    }
    if (isUntracked(file)) {
      push(file.path);
      continue;
    }
    if (file.worktree !== "." && file.worktree !== "?") {
      if (file.origPath) {
        push(file.origPath);
      }
      push(file.path);
    }
  }
  return paths;
}

export function unstagedChangeCount(status: GitStatus): number {
  return status.counts.modified + status.counts.untracked;
}

export function isWorkingTreeEmpty(status: GitStatus): boolean {
  return (
    status.counts.staged === 0 &&
    status.counts.modified === 0 &&
    status.counts.untracked === 0
  );
}

/**
 * Push-after-commit eligibility from the pre-commit snapshot.
 * Do not use `resolveRemoteSyncDecision`: a synced branch still needs push
 * after the new commit.
 */
export function resolveCommitPushAfter(status: GitStatus): GitCommitPushAfter {
  if (status.branch.branch === null) {
    return { action: null, disabledReason: null, visible: false };
  }
  if (status.remoteSync?.state === "authRequired") {
    return { action: null, disabledReason: "auth", visible: true };
  }
  if (canPublishBranch(status)) {
    return { action: "publish", disabledReason: null, visible: true };
  }
  if (status.branch.upstream !== null && !status.branch.upstreamGone) {
    return { action: "push", disabledReason: null, visible: true };
  }
  return { action: null, disabledReason: "unavailable", visible: true };
}
