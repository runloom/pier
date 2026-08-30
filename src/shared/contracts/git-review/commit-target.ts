import type { GitReviewTarget } from "./base.ts";

export type GitReviewCommitTarget = Extract<
  GitReviewTarget,
  { kind: "commit" }
>;

export type GitReviewCommitRangeTarget = GitReviewCommitTarget & {
  readonly fromOid: string;
};

export function canonicalizeGitReviewTarget(
  target: GitReviewTarget
): GitReviewTarget {
  if (target.kind !== "commit") {
    return target;
  }
  if (target.fromOid === undefined || target.fromOid === target.oid) {
    return { kind: "commit", oid: target.oid };
  }
  return {
    fromOid: target.fromOid,
    kind: "commit",
    oid: target.oid,
  };
}

export function isGitReviewCommitRange(
  target: GitReviewTarget
): target is GitReviewCommitRangeTarget {
  const canonical = canonicalizeGitReviewTarget(target);
  return canonical.kind === "commit" && canonical.fromOid !== undefined;
}

export function gitReviewTargetIdentityKey(target: GitReviewTarget): string {
  const canonical = canonicalizeGitReviewTarget(target);
  if (canonical.kind === "uncommitted") {
    return "uncommitted";
  }
  if (canonical.kind === "branch") {
    return `branch:${canonical.ref}`;
  }
  if (canonical.fromOid !== undefined) {
    return `commit:${canonical.fromOid}..${canonical.oid}`;
  }
  return `commit:${canonical.oid}`;
}
