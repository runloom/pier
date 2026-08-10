import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitReviewGroup } from "@shared/contracts/git/review.ts";

/**
 * Agent 状态栏 / 评论操作弹窗可处理的行内评论。
 * 口径：git-diff + 未提交变更面 + 仍有存活正文 + 路径仍在当前工作区变更中
 * （与打开 Changes 的 uncommitted 一致；commit/discard 后不再计入）。
 *
 * 注意：v1 只做展示过滤，不自动软删存储中的孤儿评论（避免 stash / 临时 clean
 * 误删）。用户点失效项时由跳转路径显式删除。
 */
export interface ProcessableCommentItem {
  readonly body: string;
  readonly commentId: string;
  readonly group: GitReviewGroup;
  readonly line: number;
  /** git-diff oldPath；跳转 stale 判定与 path 共用 {@link pathInLiveSet}。 */
  readonly oldPath: string | null;
  readonly path: string;
  readonly side: "new" | "old";
  readonly threadId: string;
  readonly updatedAt: number;
}

export interface ListProcessableCommentsOptions {
  /**
   * 当前未提交变更路径（含重命名 origPath）。传入后剔除 path 已不在变更中的评论
   * （典型：对应 diff 已 commit）。省略则不做路径过滤（单测 / 尚未拿到 status）。
   */
  readonly livePaths?: ReadonlySet<string>;
}

function isUncommittedGitDiff(
  thread: CommentThread
): thread is CommentThread & {
  target: Extract<CommentThread["target"], { kind: "git-diff" }>;
} {
  if (thread.target.kind !== "git-diff") {
    return false;
  }
  return thread.target.scope.target.kind === "uncommitted";
}

/** path 或 oldPath 任一仍在变更集合中 → 仍可定位。 */
export function pathInLiveSet(
  path: string,
  oldPath: string | null,
  livePaths: ReadonlySet<string>
): boolean {
  if (livePaths.has(path)) {
    return true;
  }
  return oldPath !== null && livePaths.has(oldPath);
}

/** 收集可交给智能体处理的评论（剔除非 uncommitted / 无存活正文 / 路径已无变更）。 */
export function listProcessableComments(
  threads: readonly CommentThread[] | undefined,
  options?: ListProcessableCommentsOptions
): ProcessableCommentItem[] {
  if (threads === undefined || threads.length === 0) {
    return [];
  }
  const livePaths = options?.livePaths;
  const items: ProcessableCommentItem[] = [];
  for (const thread of threads) {
    if (!isUncommittedGitDiff(thread)) {
      continue;
    }
    if (
      livePaths !== undefined &&
      !pathInLiveSet(thread.target.path, thread.target.oldPath, livePaths)
    ) {
      continue;
    }
    // One processable row per live comment (not only the first in the thread).
    for (const comment of thread.comments) {
      if (comment.deletedAt !== undefined || !comment.body.trim()) {
        continue;
      }
      items.push({
        body: comment.body.trim(),
        commentId: comment.id,
        group: thread.target.group,
        line: thread.target.line,
        oldPath: thread.target.oldPath,
        path: thread.target.path,
        side: thread.target.side,
        threadId: thread.id,
        updatedAt: thread.updatedAt,
      });
    }
  }
  items.sort((left, right) => {
    const byPath = left.path.localeCompare(right.path);
    if (byPath !== 0) {
      return byPath;
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.side !== right.side) {
      return left.side === "old" ? -1 : 1;
    }
    const byThread = left.threadId.localeCompare(right.threadId);
    if (byThread !== 0) {
      return byThread;
    }
    return left.commentId.localeCompare(right.commentId);
  });
  return items;
}

export function processableCommentCount(
  threads: readonly CommentThread[] | undefined,
  options?: ListProcessableCommentsOptions
): number {
  return listProcessableComments(threads, options).length;
}

/** 写入智能体输入框的评论块（纯文本，便于 agent 阅读）。 */
export function formatCommentsForComposer(
  items: readonly ProcessableCommentItem[]
): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((item) => {
    const anchor = `${item.path}:${item.line}`;
    return `- \`${anchor}\`: ${item.body}`;
  });
  return ["Please address these review comments:", "", ...lines].join("\n");
}

export function mergeComposerText(existing: string, addition: string): string {
  const add = addition.trim();
  if (add.length === 0) {
    return existing;
  }
  const base = existing.replace(/\s+$/u, "");
  if (base.length === 0) {
    return add;
  }
  return `${base}\n\n${add}`;
}
