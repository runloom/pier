import type {
  GitReviewFileStatus,
  GitReviewGroup,
} from "../../../shared/contracts/git-review.ts";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import { GIT_REVIEW_MAX_FILES } from "./git-review-budget.ts";

export const GIT_REVIEW_INDEX_ENTRY_LIMIT = GIT_REVIEW_MAX_FILES;
/** staged/unstaged 链最多各占一个事实；4,001 个事实足以证明超过 2,000 个最终文件。 */
export const GIT_REVIEW_INDEX_PRIMARY_FACT_LIMIT =
  GIT_REVIEW_INDEX_ENTRY_LIMIT * 2;
/** porcelain v2 的 4,001 个 rename/copy 事实的最坏物理 record 数。 */
export const GIT_REVIEW_INDEX_MAX_NUL_RECORDS =
  (GIT_REVIEW_INDEX_PRIMARY_FACT_LIMIT + 1) * 2;
/** raw/numstat 完整读取第 2,001 个 rename/copy tuple 所需的 record 数。 */
export const GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS =
  (GIT_REVIEW_INDEX_ENTRY_LIMIT + 1) * 3;
export const GIT_REVIEW_RENAME_LIMIT = 2000;

export interface GitReviewIndexExecutionBudget extends GitExecExecutionBudget {
  tryConsumeFiles(delta?: number): boolean;
}

export interface GitReviewIndexGroupFact {
  readonly movement: "copy" | "rename" | null;
  readonly oldPath: string | null;
  readonly origin: "conflict" | "tracked" | "untracked";
  readonly statsExpected: boolean;
  readonly status: GitReviewFileStatus;
  readonly targetPath: string;
}

export interface GitReviewIndexPrimaryEntry {
  readonly groupFacts: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>
  >;
  readonly path: string;
}

export interface GitReviewIndexStatEntry {
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly oldPath: string | null;
  readonly path: string;
}

export interface GitReviewIndexPrimaryParseResult {
  readonly digestByGroup: Readonly<Partial<Record<GitReviewGroup, string>>>;
  readonly entries: readonly GitReviewIndexPrimaryEntry[];
  readonly indexDigest: string | null;
  readonly invalidPathEntries: number;
  readonly truncated: boolean;
}

export interface GitReviewIndexStatParseResult {
  readonly digest: string;
  readonly entries: readonly GitReviewIndexStatEntry[];
  readonly truncated: boolean;
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
