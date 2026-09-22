import type { GitReviewScope } from "../../../../shared/contracts/git/review.ts";

/** One painted revision per scope. The cap only drops scopes that aged out. */
const GIT_REVIEW_INDEX_SNAPSHOT_LIMIT = 32;

export class GitReviewIndexSnapshotCache<
  T extends { readonly metadata: { readonly indexRevision: string } },
> {
  readonly #snapshots: Array<{ readonly key: string; readonly resolution: T }> =
    [];

  recall(scope: GitReviewScope, indexRevision: string): T | null {
    const key = gitReviewIndexSnapshotKey(scope);
    const hit = this.#snapshots.find(
      (snapshot) =>
        snapshot.key === key &&
        snapshot.resolution.metadata.indexRevision === indexRevision
    );
    return hit?.resolution ?? null;
  }

  remember(scope: GitReviewScope, resolution: T): void {
    const key = gitReviewIndexSnapshotKey(scope);
    const next = this.#snapshots.filter((snapshot) => snapshot.key !== key);
    next.push({ key, resolution });
    while (next.length > GIT_REVIEW_INDEX_SNAPSHOT_LIMIT) {
      next.shift();
    }
    this.#snapshots.splice(0, this.#snapshots.length, ...next);
  }
}

function gitReviewIndexSnapshotKey(scope: GitReviewScope): string {
  return JSON.stringify([scope.contextId, scope.gitRootPath, scope.target]);
}
