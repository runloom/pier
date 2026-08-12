import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
} from "react";
import type { ReviewCommentIndex } from "../review/document/comment-projection.ts";
import type { GitReviewDocumentGeneration } from "../review/document/generation.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import { useGitReviewCommentsProjection } from "./use-comments-projection.ts";
import { useGitReviewLocaleProjection } from "./use-locale-projection.ts";
import { useReviewComments } from "./use-review-comments.ts";

/**
 * 评论数据贯通集成：订阅项目评论 → ref 镜像 → locale + comments 重投影。
 *
 * 聚合 useReviewComments（订阅）、commentsIndexRef/commentsSeqRef（ref 镜像供
 * generation effect 闭包读最新评论）、useGitReviewLocaleProjection +
 * useGitReviewCommentsProjection（重投影）为一次调用，content.tsx 拿 ref 传给
 * useGitReviewDocumentSession。
 *
 * 评论是轻量叠加层：commentsSeq 变化触发 comments projection 重投影（不重建
 * generation，避免丢正文 / scroll 抖动）；locale 变化触发 locale projection 重投影。
 * 两者都用现有 controller/loader snapshot + 完整 options 重算，互不干扰。effect
 * 在 generation 挂载前注册：首次跑 controller 未就绪 / seq 未变 → 跳过，初始
 * projection 由 generation 内 projectReviewLedger 带评论生成。
 */
export function useGitReviewCommentsIntegration({
  collidingFileLabel,
  context,
  scope,
  controllerRef,
  diffBase,
  entries,
  indexGeneration,
  loaderRef,
  locale,
  projectedLocaleRef,
  recordLatestItemUpdates,
  setProjection,
}: {
  readonly collidingFileLabel: (name: string) => string;
  readonly context: RendererPluginContext;
  readonly scope: GitReviewScope;
  readonly controllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly diffBase: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly indexGeneration: number;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly locale: string;
  readonly projectedLocaleRef: RefObject<string>;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
}): {
  readonly commentsIndexRef: RefObject<ReviewCommentIndex | null>;
  readonly commentsSeqRef: RefObject<number>;
  /** 完整线程（线程卡浮层用）；null = 未水合。 */
  readonly threads: readonly CommentThread[] | null;
} {
  const { commentsIndex, commentsSeq, threads } = useReviewComments(
    context,
    scope
  );
  const commentsIndexRef = useRef<ReviewCommentIndex | null>(null);
  const commentsSeqRef = useRef(0);
  // ref 镜像：generation effect 闭包通过 ref 读最新评论，避免捕获旧值。
  commentsIndexRef.current = commentsIndex;
  commentsSeqRef.current = commentsSeq;
  useGitReviewLocaleProjection({
    collidingFileLabel,
    commentsIndexRef,
    commentsSeqRef,
    context,
    controllerRef,
    diffBase,
    entries,
    indexGeneration,
    loaderRef,
    locale,
    projectedLocaleRef,
    recordLatestItemUpdates,
    setProjection,
  });
  useGitReviewCommentsProjection({
    collidingFileLabel,
    commentsIndexRef,
    commentsSeq,
    commentsSeqRef,
    context,
    controllerRef,
    diffBase,
    entries,
    indexGeneration,
    loaderRef,
    projectedLocaleRef,
    recordLatestItemUpdates,
    setProjection,
  });
  return { commentsIndexRef, commentsSeqRef, threads };
}
