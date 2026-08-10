import type { CommentThread } from "@shared/contracts/comments/base.ts";
import { pathInLiveSet } from "./processable.ts";

export interface OrphanCommentDelete {
  readonly commentId: string;
  readonly threadId: string;
}

function isUncommittedScoped(thread: CommentThread): thread is CommentThread & {
  target: Extract<CommentThread["target"], { kind: "git-diff" | "git-file" }>;
} {
  if (thread.target.kind !== "git-diff" && thread.target.kind !== "git-file") {
    return false;
  }
  return thread.target.scope.target.kind === "uncommitted";
}

/**
 * 未提交锚点评论，但其 path 已不在当前工作区变更中。
 *
 * **不自动后台调用**：stash / 临时 clean 也会让 path 暂时离开 status，
 * 自动软删会丢数据。UI 用 {@link listProcessableComments} 过滤即可；
 * 用户点失效跳转时由 dialog 显式 delete。本函数供显式清理与测试。
 */
export function listOrphanUncommittedDeletes(
  threads: readonly CommentThread[] | undefined,
  livePaths: ReadonlySet<string>
): OrphanCommentDelete[] {
  if (threads === undefined || threads.length === 0) {
    return [];
  }
  const deletes: OrphanCommentDelete[] = [];
  for (const thread of threads) {
    if (!isUncommittedScoped(thread)) {
      continue;
    }
    const oldPath =
      thread.target.kind === "git-diff" ? thread.target.oldPath : null;
    if (pathInLiveSet(thread.target.path, oldPath, livePaths)) {
      continue;
    }
    for (const comment of thread.comments) {
      if (comment.deletedAt !== undefined) {
        continue;
      }
      deletes.push({ commentId: comment.id, threadId: thread.id });
    }
  }
  return deletes;
}

interface PruneQueueEntry {
  livePaths: ReadonlySet<string>;
  threads: readonly CommentThread[] | undefined;
}

/** 同 worktree 串行 + 飞行中再请求则合并为一次 follow-up。 */
const pruneQueues = new Map<
  string,
  { inFlight: boolean; pending: PruneQueueEntry | null }
>();

/**
 * 软删孤儿未提交评论（显式调用）。失败静默；返回成功删除条数。
 * 飞行中再次调用会排队用**最新** threads/livePaths 再跑一轮。
 */
export async function pruneOrphanUncommittedComments(
  worktreeKey: string,
  threads: readonly CommentThread[] | undefined,
  livePaths: ReadonlySet<string>
): Promise<number> {
  let queue = pruneQueues.get(worktreeKey);
  if (queue === undefined) {
    queue = { inFlight: false, pending: null };
    pruneQueues.set(worktreeKey, queue);
  }
  if (queue.inFlight) {
    queue.pending = { livePaths, threads };
    return 0;
  }
  queue.inFlight = true;
  let deletedTotal = 0;
  let batch: PruneQueueEntry = { livePaths, threads };
  try {
    for (;;) {
      const targets = listOrphanUncommittedDeletes(
        batch.threads,
        batch.livePaths
      );
      for (const target of targets) {
        try {
          const result = await window.pier.comments.deleteComment({
            commentId: target.commentId,
            threadId: target.threadId,
            worktreeKey,
          });
          if (result.kind === "ok") {
            deletedTotal += 1;
          }
        } catch {
          // 单条失败继续；整体可重试。
        }
      }
      const next = queue.pending;
      queue.pending = null;
      if (next === null) {
        break;
      }
      batch = next;
    }
    return deletedTotal;
  } finally {
    queue.inFlight = false;
    const leftover = queue.pending;
    queue.pending = null;
    if (leftover === null) {
      pruneQueues.delete(worktreeKey);
    } else {
      // 循环退出与 finally 之间又入队：异步再跑一轮，勿丢。
      pruneOrphanUncommittedComments(
        worktreeKey,
        leftover.threads,
        leftover.livePaths
      ).catch(() => undefined);
    }
  }
}

/** 测试用：清空 in-flight 队列。 */
export function resetOrphanPruneStateForTests(): void {
  pruneQueues.clear();
}
