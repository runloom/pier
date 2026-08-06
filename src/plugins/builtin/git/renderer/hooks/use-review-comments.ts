import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { CommentProjectSnapshot } from "@shared/contracts/comments/document.ts";
import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import { useEffect, useMemo, useState } from "react";
import {
  indexReviewComments,
  type ReviewCommentIndex,
} from "../review/document/comment-projection.ts";

export interface ReviewCommentsState {
  /** null = 未水合（首拉前 / 首拉失败 / 切 worktree 清空）。 */
  readonly commentsIndex: ReviewCommentIndex | null;
  /** 评论 per-project seq；0 = 未水合。上层据此触发重投影。 */
  readonly commentsSeq: number;
  /**
   * 完整线程（线程卡浮层按 threadId 取完整评论正文/作者/时间用）；
   * null = 未水合。与 commentsIndex 同源（均来自 snapshot.threads）。
   */
  readonly threads: readonly CommentThread[] | null;
}

const EMPTY_STATE: ReviewCommentsState = Object.freeze({
  commentsIndex: null,
  commentsSeq: 0,
  threads: null,
});

/**
 * 订阅项目评论快照，把 CommentProjectSnapshot.threads 投影成
 * {@link ReviewCommentIndex}（按 (group, path) 索引行内 diff 评论）。
 *
 * scope.gitRootPath 作 worktreeKey（comments scope 复用 gitReviewScope，
 * worktreeKey 与 gitRootPath 同源）。评论是轻量叠加层：commentsSeq 单调
 * 递增触发上层重投影，**不重建 document generation**（避免丢正文 / scroll 抖动）。
 *
 * seq 守卫：首拉（snapshot）与广播（watch）竞态时，旧 seq 不覆盖新 seq
 * （对齐 notification-center 镜像 store 单调守卫）。切 worktree 显式清空
 * （跨项目 seq 不可比）。
 */
export function useReviewComments(
  context: RendererPluginContext,
  scope: GitReviewScope
): ReviewCommentsState {
  const { gitRootPath } = scope;
  const [snapshot, setSnapshot] = useState<CommentProjectSnapshot | null>(null);
  useEffect(() => {
    let disposed = false;
    // 切 worktree 先清空：跨项目 seq 不可比，禁止新项目显示旧项目评论。
    setSnapshot(null);
    const apply = (snap: CommentProjectSnapshot): void => {
      if (disposed) {
        return;
      }
      setSnapshot((prev) =>
        prev !== null && snap.seq < prev.seq ? prev : snap
      );
    };
    context.comments
      .snapshot(gitRootPath)
      .then((snap) => {
        if (snap !== null) {
          apply(snap);
        }
      })
      .catch(() => undefined);
    const dispose = context.comments.watch(gitRootPath, apply);
    return () => {
      disposed = true;
      dispose();
    };
  }, [context, gitRootPath]);
  return useMemo<ReviewCommentsState>(
    () =>
      snapshot === null
        ? EMPTY_STATE
        : {
            commentsIndex: indexReviewComments(snapshot.threads),
            commentsSeq: snapshot.seq,
            threads: snapshot.threads,
          },
    [snapshot]
  );
}
