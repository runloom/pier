import type { ExecGitRaw } from "../../git/exec.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "../index/contract.ts";
import type { GitReviewRangeBounds } from "../index/range.ts";

export const GIT_REVIEW_PATCH_MAX_BYTES = 8 * 1024 * 1024;

export type GitReviewRenderableGroup =
  | "committed"
  | "staged"
  | "unstaged"
  | "working";

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
      readonly newContents?: string;
      readonly oldContents?: string;
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

/** 可渲染分组的 fact：conflicted 状态只属于 conflict section。 */
export type GitReviewRenderableFact = GitReviewIndexGroupFact & {
  readonly status: Exclude<GitReviewIndexGroupFact["status"], "conflicted">;
};

/** 派生面没有工作区槽：工作区侧是否存在决定要不要 fence 正文。 */
export type GitReviewPatchWorktreeSide = "absent" | "present";

/**
 * fact 的背书来源，决定「读不到内容」的语义：
 *
 * - `index-slot`：由 index 槽背书（staged / unstaged / committed / conflict）。
 *   读不到 = 索引事实已过期，走 stale 重试；patch 必须与槽的路径、状态、对象一致。
 * - `derived`：由槽派生的组合阅读面（working）。没有自己的事实：工作区侧不存在就没有可
 *   fence 的正文，git 给不出单一目标记录时该面不存在。派生面禁止产生失败或重试。
 */
export type GitReviewPatchBacking =
  | { readonly kind: "index-slot" }
  | {
      readonly kind: "derived";
      readonly worktreeSide: GitReviewPatchWorktreeSide;
    };

/** 省略 {@link ReadGitReviewPatchOptions.backing} 即槽背书。 */
export const GIT_REVIEW_INDEX_SLOT_BACKING: GitReviewPatchBacking =
  Object.freeze({
    kind: "index-slot",
  });

export interface ReadGitReviewPatchOptions {
  readonly backing?: GitReviewPatchBacking;
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly fact: GitReviewIndexGroupFact;
  readonly gitRootPath: string;
  readonly group: GitReviewRenderableGroup;
  readonly headOid: string | null;
  /**
   * When false, return the hunk patch without reading full old/new text.
   * Expand of collapsed unmodified lines stays partial until a later read.
   */
  readonly includeDiffSides?: boolean;
  /** committed 分组必需的 range 边界；其他分组为 null。 */
  readonly rangeBounds?: GitReviewRangeBounds | null;
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
