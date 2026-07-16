import type { ExecGitRaw } from "../git-exec.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "./git-review-index-contract.ts";

export const GIT_REVIEW_PATCH_MAX_BYTES = 8 * 1024 * 1024;

export type GitReviewRenderableGroup = "staged" | "unstaged";

export type GitReviewPatchStateReason =
  | "binary"
  | "invalidEncoding"
  | "readError"
  | "submodule"
  | "symlink"
  | "tooLarge";

export type GitReviewPatchMaterial =
  | {
      readonly kind: "patch";
      readonly patch: string;
      readonly sourceOid: string | null;
      readonly sourceRevision: string;
      readonly targetOid: string | null;
    }
  | {
      readonly kind: "state";
      readonly reason: GitReviewPatchStateReason;
      readonly sourceOid: string | null;
      readonly sourceRevision: string;
      readonly targetOid: string | null;
    };

export interface ReadGitReviewPatchOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly fact: GitReviewIndexGroupFact;
  readonly gitRootPath: string;
  readonly group: GitReviewRenderableGroup;
  readonly headOid: string | null;
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
