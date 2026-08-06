import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import type { ReviewCommentIndex } from "../review/document/comment-projection.ts";
import type { GitReviewDocumentGeneration } from "../review/document/generation.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  projectReviewLedger,
  type ReviewDocumentProjection,
} from "../review/document/projection.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";

/**
 * 评论 seq 变化时全 content 账本重投影（对齐 useGitReviewLocaleProjection 模式）。
 *
 * 评论是轻量叠加层：commentsSeq 单调递增触发重投影，**不重建 document generation**
 * （避免丢正文 / scroll 抖动）。用现有 controller/loader 的 snapshot 取当前资源，
 * 读 projectedLocaleRef.current（最新已投影 locale）避免评论重投影回退 locale。
 *
 * 与 locale projection 互不干扰：两者都用 controller/loader + 完整 options 重算，
 * 结果一致；seq 未变（projectedCommentsSeqRef 去重）或 controller/loader 未就绪时跳过。
 */
export function useGitReviewCommentsProjection({
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
}: {
  readonly commentsIndexRef: RefObject<ReviewCommentIndex | null>;
  /** 评论 per-project seq（state，触发重投影）；未变则跳过。 */
  readonly commentsSeq: number;
  /** 同步 ref：generation effect 闭包通过此读最新 seq。 */
  readonly commentsSeqRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly controllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly diffBase: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly indexGeneration: number;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly projectedLocaleRef: RefObject<string>;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
}): void {
  const projectedCommentsSeqRef = useRef(0);
  useEffect(() => {
    if (projectedCommentsSeqRef.current === commentsSeq) {
      return;
    }
    const controller = controllerRef.current;
    const loader = loaderRef.current;
    if (!(controller && loader)) {
      return;
    }
    const snapshot = controller.snapshot(loader.getRetainedEntryKeys());
    projectedCommentsSeqRef.current = commentsSeq;
    commentsSeqRef.current = commentsSeq;
    const resourceByEntryKey = new Map(
      snapshot.resources.map(
        (resource) => [resource.entry.entryKey, resource] as const
      )
    );
    const comments = commentsIndexRef.current;
    const reprojected = projectReviewLedger({
      authoritativeEntryKeys: controller.authoritativeEntryKeys(),
      ...(comments === null ? {} : { comments }),
      commentsSeq,
      context,
      diffBase,
      entries,
      locale: projectedLocaleRef.current,
      resourceByEntryKey,
      sourceIndexGeneration: indexGeneration,
    });
    recordLatestItemUpdates(reprojected.items);
    setProjection(reprojected);
  }, [
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
  ]);
}
