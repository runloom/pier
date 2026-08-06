import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { type RefObject, useEffect, useRef } from "react";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";
import { reviewTreeSectionKeyForSurface } from "../review/document/projection-index.ts";
import { reviewSurfaceForGroup } from "../review/surface-group.ts";
import type {
  PendingCommentReveal,
  ReviewTreeOpenReveal,
} from "../review/surface-types.ts";
import { useGitReviewGutterBindings } from "./use-review-gutter-bindings.ts";
import { useReviewInlineThreads } from "./use-review-inline-threads.ts";

/**
 * 评论 gutter 入口 + 行内激活态 + drift 浮层装配。
 *
 * 合并 `useGitReviewGutterBindings`（gutter 入口数据/文案）与
 * `useReviewInlineThreads`（行内多 slot 激活态 + drift 浮层 + 写操作），
 * 让 `content.tsx` 装配面只持有一处评论调用，控制文件行数。
 */
export function useReviewCommentsBinding({
  context,
  entries,
  entryKeyBySectionIdRef,
  locale,
  onPendingRevealHandled,
  onRequestTreeOpen,
  pendingReveal,
  projection,
  scope,
  threads,
}: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly locale: string;
  /** Clear dockview `pendingReveal` after a successful handoff start. */
  readonly onPendingRevealHandled?: (() => void) | undefined;
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: ReviewTreeOpenReveal
  ) => void;
  readonly pendingReveal?: PendingCommentReveal | null | undefined;
  readonly projection: ReviewDocumentProjection;
  readonly scope: GitReviewScope;
  readonly threads: readonly CommentThread[] | null;
}): ReturnType<typeof useReviewInlineThreads> &
  ReturnType<typeof useGitReviewGutterBindings> {
  const gutterBindings = useGitReviewGutterBindings({
    context,
    locale,
    projection,
  });
  const inlineThreads = useReviewInlineThreads({
    context,
    entries,
    entryKeyBySectionIdRef,
    locale,
    scope,
    threads,
  });
  // 评论 reveal：状态栏跳转意图 → 反查 entryKey/sectionKey → onRequestTreeOpen
  // 携带行级 reveal；section 导航物化后 handoff 调 scrollToLine。nonce 去重。
  // 仅在 entry+section 就绪后写 lastNonce 并清 params，避免 index 未到时丢意图。
  const lastRevealNonceRef = useRef(0);
  useEffect(() => {
    if (pendingReveal === null || pendingReveal === undefined) {
      return;
    }
    if (lastRevealNonceRef.current === pendingReveal.nonce) {
      return;
    }
    const entry = entries.find((item) => item.path === pendingReveal.path);
    if (entry === undefined) {
      return;
    }
    const surface = reviewSurfaceForGroup(pendingReveal.group);
    const sectionKey = reviewTreeSectionKeyForSurface(entry, surface);
    if (sectionKey === null) {
      return;
    }
    lastRevealNonceRef.current = pendingReveal.nonce;
    onRequestTreeOpen(entry.entryKey, sectionKey, pendingReveal.group, {
      line: pendingReveal.line,
      side: pendingReveal.side,
    });
    onPendingRevealHandled?.();
  }, [entries, onPendingRevealHandled, onRequestTreeOpen, pendingReveal]);
  return { ...gutterBindings, ...inlineThreads };
}
