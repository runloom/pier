import type { GitReviewResolvedQuery } from "../../../shared/contracts/git-review.ts";
import type { ExecGitRaw } from "../git-exec.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "./git-review-index-contract.ts";

export const GIT_REVIEW_PATCH_MAX_BYTES = 8 * 1024 * 1024;
export const GIT_REVIEW_DEFAULT_CONTEXT_LINES = 20;

export type GitReviewRenderableGroup =
  | "branch"
  | "commit"
  | "staged"
  | "unstaged";

export type GitReviewPatchStateReason =
  | "binary"
  | "invalidEncoding"
  | "readError"
  | "submodule"
  | "symlink"
  | "tooLarge";

export type GitReviewPatchMaterial =
  | {
      readonly additions: number;
      readonly byteSize: number;
      readonly deletions: number;
      readonly kind: "patch";
      readonly lineCount: number;
      readonly patch: string;
      readonly sourceOid: string | null;
      readonly sourceRevision: string;
      readonly targetOid: string | null;
    }
  | {
      readonly byteSize: number | null;
      readonly kind: "state";
      readonly lineCount: number | null;
      readonly message: string | null;
      readonly reason: GitReviewPatchStateReason;
      readonly sourceOid: string | null;
      readonly sourceRevision: string;
      readonly targetOid: string | null;
    };

export interface ReadGitReviewPatchOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  /** 测试 seam；生产默认在 os.tmpdir() 下创建 0700 临时目录。 */
  readonly createTemporaryRoot?: () => Promise<string>;
  readonly execGitRaw: ExecGitRaw;
  readonly fact: GitReviewIndexGroupFact;
  readonly gitRootPath: string;
  readonly group: GitReviewRenderableGroup;
  readonly query: GitReviewResolvedQuery;
  readonly signal?: AbortSignal;
}

export class GitReviewDocumentStaleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitReviewDocumentStaleError";
  }
}

/** Git 输出或内部调用违反确定性 document 协议；重试不会自行恢复。 */
export class GitReviewDocumentProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitReviewDocumentProtocolError";
  }
}
