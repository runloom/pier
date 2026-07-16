import type {
  GitReviewFileStatus,
  GitReviewGroup,
} from "../../../shared/contracts/git-review.ts";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";

export const GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS = 128;

export type GitReviewIndexExecutionBudget = GitExecExecutionBudget;

export interface GitReviewIndexGroupFact {
  readonly movement: "copy" | "rename" | null;
  readonly oldPath: string | null;
  readonly origin: "conflict" | "tracked" | "untracked";
  /** 本 section 的 Git 原始侧对象；worktree/untracked 没有对象时为 null。 */
  readonly sourceOid: string | null;
  readonly statsExpected: boolean;
  readonly status: GitReviewFileStatus;
  /** 本 section 的 Git 目标侧对象；worktree/untracked 没有对象时为 null。 */
  readonly targetOid: string | null;
  readonly targetPath: string;
}

export interface GitReviewIndexPrimaryEntry {
  readonly groupFacts: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>
  >;
  readonly path: string;
}

export interface GitReviewIndexPrimaryParseResult {
  readonly digestByGroup: Readonly<Partial<Record<GitReviewGroup, string>>>;
  readonly entries: readonly GitReviewIndexPrimaryEntry[];
  readonly invalidPathEntries: number;
}

export interface GitReviewIndexStatParseResult {
  readonly digest: string;
}

export class GitReviewIndexProtocolError extends Error {
  readonly kind = "protocol";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitReviewIndexProtocolError";
  }
}

export class GitReviewIndexExecutionError extends Error {
  readonly kind: "aborted" | "output-limit" | "timeout";

  constructor(kind: GitReviewIndexExecutionError["kind"], message: string) {
    super(message);
    this.name = "GitReviewIndexExecutionError";
    this.kind = kind;
  }
}

export class GitReviewIndexInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitReviewIndexInputError";
  }
}
