import { raceGitReviewIdentityBoundary } from "./git-review-identity-boundary.ts";
import type { GitReviewIndexExecutionBudget } from "./git-review-index-contract.ts";
import { removeGitReviewTemporaryRoot } from "./git-review-temporary-root.ts";

export async function cleanupGitReviewTemporaryRoot(
  temporaryRoot: string,
  budget: GitReviewIndexExecutionBudget
): Promise<void> {
  await raceGitReviewIdentityBoundary(
    () => removeGitReviewTemporaryRoot(temporaryRoot),
    {
      timeoutMs: 1000,
      ...(budget.trackDetachedOperation === undefined
        ? {}
        : {
            trackDetachedOperation: (operation: Promise<unknown>) =>
              budget.trackDetachedOperation?.(operation),
          }),
    }
  );
}

export function cleanupLateGitReviewTemporaryRoot(
  temporaryRootPromise: Promise<string>,
  budget: GitReviewIndexExecutionBudget
): void {
  const cleanup = temporaryRootPromise.then((temporaryRoot) =>
    cleanupGitReviewTemporaryRoot(temporaryRoot, budget)
  );
  budget.trackDetachedOperation?.(cleanup);
  cleanup.catch(() => undefined);
}
