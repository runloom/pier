/**
 * 评论身份校验（设计文档 §6「身份校验」+ 2026-08-11 多 kind 分派）。
 *
 * 对齐 panel-context-resolver 的 contextIdFor：worktreeKey → ctx:<sha256[:16]>，
 * 保证评论 contextId 与 PanelContext.contextId 同源（设计文档 §5：contextId 由
 * worktreeKey 稳定派生，不单独持久化）。本模块不跑 git 命令——评论身份只需
 * path 比对 + contextId 派生，不需要重新解析 git（与 git-review 的 canonicalSource
 * 不同：后者要 rev-parse，评论只需词法一致性校验）。
 */
import { createHash } from "node:crypto";
import type {
  CommentTarget,
  GitCommentScope,
} from "@shared/contracts/comments/base.ts";
import type { CommentFailure } from "@shared/contracts/comments/primitives.ts";
import { commentFailureSchema } from "@shared/contracts/comments/primitives.ts";

/** worktreeKey → contextId：与 panel-context-resolver.contextIdFor 同算法。 */
export function contextIdFor(worktreeKey: string): string {
  const hash = createHash("sha256")
    .update(worktreeKey)
    .digest("hex")
    .slice(0, 16);
  return `ctx:${hash}`;
}

function failure(
  reason: CommentFailure["reason"],
  retryable: boolean,
  message: string
): CommentFailure {
  return commentFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}

/**
 * 校验写操作的 scope 与 worktreeKey 派生一致（设计文档 §6：renderer 不得把词法
 * 路径当授权身份，写入前校验 gitRootPath 与 worktreeKey 的派生一致性）。
 *
 * - contextId 必须等于 contextIdFor(worktreeKey)。
 * - gitRootPath 必须与 worktreeKey 词法一致（两者都已是 realpath：worktreeKey
 *   来自 PanelContext，gitRootPath 来自 review scope canonicalize）。
 *
 * 返回 null 表示通过，CommentFailure 表示失败。
 */
export function assertCommentScope(
  worktreeKey: string,
  scope: GitCommentScope
): CommentFailure | null {
  if (scope.contextId !== contextIdFor(worktreeKey)) {
    return failure(
      "invalidSource",
      false,
      "评论 scope.contextId 与 worktreeKey 派生不一致"
    );
  }
  if (scope.gitRootPath !== worktreeKey) {
    return failure(
      "invalidSource",
      false,
      "评论 scope.gitRootPath 与 worktreeKey 不一致"
    );
  }
  return null;
}

/**
 * 按锚点 kind 分派创建前校验。
 * - git-diff / git-file：scope 与 worktreeKey 派生一致。
 * - markdown / canvas：worktreeKey 非空即可（path 相对性由 zod 保证）。
 */
export function assertCommentTarget(
  worktreeKey: string,
  target: CommentTarget
): CommentFailure | null {
  if (worktreeKey.length === 0) {
    return failure("invalidSource", false, "worktreeKey 为空");
  }
  if (target.kind === "git-diff" || target.kind === "git-file") {
    return assertCommentScope(worktreeKey, target.scope);
  }
  return null;
}
