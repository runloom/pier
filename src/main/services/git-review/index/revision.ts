import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { gitChangeSummaryStatToken } from "../../git/untracked-path-stats.ts";
import type { GitReviewIndexResolvedEntry } from "./assembler.ts";
import type { GitReviewIndexExecutionBudget } from "./contract.ts";
import { assertGitReviewIndexExecutionActive } from "./execution.ts";

export function createGitReviewIndexRevision(
  contentRevision: string,
  headOid: string | null,
  workingTreeRevision: string | null
): string {
  const digest = createHash("sha256");
  for (const part of [
    "pier.git-review.index-revision.v1",
    contentRevision,
    headOid ?? "unborn",
    workingTreeRevision ?? "immutable",
  ]) {
    digest.update(part, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

export async function createGitReviewWorkingTreeRevision(
  canonicalRoot: string,
  entries: readonly GitReviewIndexResolvedEntry[],
  stableUntrackedStatTokens: ReadonlyMap<string, string>,
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined
): Promise<string> {
  const paths = [
    ...new Set(
      entries.flatMap((entry) => {
        const unstaged = entry.groupFacts.unstaged;
        return unstaged === undefined ? [] : [unstaged.targetPath];
      })
    ),
  ].sort();
  const digest = createHash("sha256");
  digest.update("pier.git-review.working-tree.v1\0", "utf8");
  const batchSize = 64;
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    assertGitReviewIndexExecutionActive(budget, signal);
    const batch = paths.slice(offset, offset + batchSize);
    const facts = await Promise.all(
      batch.map(async (path) => {
        const stableStatToken = stableUntrackedStatTokens.get(path);
        if (stableStatToken !== undefined) {
          return stableStatToken;
        }
        try {
          const stat = await lstat(resolve(canonicalRoot, path), {
            bigint: true,
          });
          return gitChangeSummaryStatToken(stat);
        } catch (error) {
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : "unknown";
          return `missing:${code}`;
        }
      })
    );
    assertGitReviewIndexExecutionActive(budget, signal);
    for (const [index, path] of batch.entries()) {
      digest.update(path, "utf8");
      digest.update("\0", "utf8");
      digest.update(facts[index] ?? "missing:unknown", "utf8");
      digest.update("\0", "utf8");
    }
  }
  return `sha256:${digest.digest("hex")}`;
}
