import type { ExecGitRaw } from "../git-exec.ts";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";

export type GitReviewObjectFormat = "sha1" | "sha256";

export interface GitReviewRepositoryBaseIdentity {
  readonly canonicalRoot: string;
  readonly objectFormat: GitReviewObjectFormat;
  readonly oidLength: 40 | 64;
}

export interface GitReviewRepositoryIdentity
  extends GitReviewRepositoryBaseIdentity {
  readonly emptyTreeOid: string;
  readonly headOid: string | null;
}

export interface GitReviewCommitIdentity {
  readonly firstParentOid: string | null;
  readonly oid: string;
  readonly parentOids: readonly string[];
}

export interface GitReviewBranchIdentity {
  readonly headOid: string;
  readonly mergeBaseOid: string;
  readonly targetOid: string;
  readonly targetRef: string;
}

export interface GitReviewIdentityExecutionOptions {
  budget?: GitExecExecutionBudget;
  deadlineAtMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CreateGitReviewIdentityResolverOptions {
  execGitRaw?: ExecGitRaw;
  realpath?: (path: string) => Promise<string>;
}

export class GitReviewIdentityError extends Error {
  readonly kind:
    | "aborted"
    | "configuration"
    | "invalidOutput"
    | "invalidReference"
    | "noMergeBase"
    | "notRepository"
    | "outputLimit"
    | "timeout"
    | "unbornHead"
    | "unsupportedObjectFormat";

  constructor(
    kind: GitReviewIdentityError["kind"],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GitReviewIdentityError";
    this.kind = kind;
  }
}
