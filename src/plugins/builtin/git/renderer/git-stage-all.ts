import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";

/**
 * Collect unique unstaged `targetPath`s for Stage All.
 * Conflict slots are never staged; each unique conflict `targetPath` counts
 * once toward `skippedConflicts`.
 */
export function collectStageAllPaths(entries: readonly GitReviewIndexEntry[]): {
  paths: string[];
  skippedConflicts: number;
} {
  const paths: string[] = [];
  const seenPaths = new Set<string>();
  const skippedConflictPaths = new Set<string>();

  for (const entry of entries) {
    for (const slot of entry.renderSlots) {
      if (slot.group === "unstaged") {
        if (!seenPaths.has(slot.targetPath)) {
          seenPaths.add(slot.targetPath);
          paths.push(slot.targetPath);
        }
        continue;
      }
      if (slot.group === "conflict") {
        skippedConflictPaths.add(slot.targetPath);
      }
    }
  }

  return {
    paths,
    skippedConflicts: skippedConflictPaths.size,
  };
}

/** Collect unique staged `targetPath`s for Unstage All. */
export function collectUnstageAllPaths(
  entries: readonly GitReviewIndexEntry[]
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const slot of entry.renderSlots) {
      if (slot.group !== "staged") {
        continue;
      }
      if (seen.has(slot.targetPath)) {
        continue;
      }
      seen.add(slot.targetPath);
      paths.push(slot.targetPath);
    }
  }
  return paths;
}

export interface GitStageAllGitApi {
  stage(cwd: string, paths: readonly string[]): Promise<unknown>;
  unstage(cwd: string, paths: readonly string[]): Promise<unknown>;
}

/** Stage collected unstaged paths. Empty path list is a no-op. */
export async function stageAllFromEntries(
  git: Pick<GitStageAllGitApi, "stage">,
  gitRootPath: string,
  entries: readonly GitReviewIndexEntry[]
): Promise<{ staged: number; skippedConflicts: number } | null> {
  const { paths, skippedConflicts } = collectStageAllPaths(entries);
  if (paths.length === 0) {
    return null;
  }
  await git.stage(gitRootPath, paths);
  return { staged: paths.length, skippedConflicts };
}

/** Unstage collected staged paths. Empty path list is a no-op. */
export async function unstageAllFromEntries(
  git: Pick<GitStageAllGitApi, "unstage">,
  gitRootPath: string,
  entries: readonly GitReviewIndexEntry[]
): Promise<{ unstaged: number } | null> {
  const paths = collectUnstageAllPaths(entries);
  if (paths.length === 0) {
    return null;
  }
  await git.unstage(gitRootPath, paths);
  return { unstaged: paths.length };
}
