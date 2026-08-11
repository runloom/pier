import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { type RefObject, useEffect, useRef } from "react";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";
import type {
  PendingCommentReveal,
  ReviewTreeOpenReveal,
} from "../review/surface-types.ts";
import { planPendingReveal } from "./pending-reveal-plan.ts";
import { useGitReviewGutterBindings } from "./use-review-gutter-bindings.ts";
import { useReviewInlineThreads } from "./use-review-inline-threads.ts";

export { resolvePendingRevealTarget } from "./pending-reveal-plan.ts";

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
  indexRefreshing = false,
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
  /** index 刷新中：path/group 短暂 miss 时保留 pendingReveal，不永久消费。 */
  readonly indexRefreshing?: boolean;
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
    getSectionPatch: (sectionItemId) => {
      const item = projection.items.find(
        (candidate) => candidate.id === sectionItemId
      );
      const patch = item?.patch;
      return typeof patch === "string" && patch.length > 0 ? patch : undefined;
    },
    locale,
    scope,
    threads,
  });
  // 评论 reveal：状态栏跳转 → planPendingReveal → open / wait / consume。
  // 本 hook 只在 entries 非空时挂载；全空工作区由 changes-panel 清 pending。
  const lastRevealNonceRef = useRef(0);
  useEffect(() => {
    if (pendingReveal === null || pendingReveal === undefined) {
      return;
    }
    if (lastRevealNonceRef.current === pendingReveal.nonce) {
      return;
    }
    const plan = planPendingReveal(pendingReveal, entries, indexRefreshing);
    if (plan.kind === "wait") {
      return;
    }
    lastRevealNonceRef.current = pendingReveal.nonce;
    if (plan.kind === "consume") {
      onPendingRevealHandled?.();
      return;
    }
    onRequestTreeOpen(plan.entryKey, plan.sectionKey, plan.group, {
      line: plan.line,
      side: plan.side,
    });
    onPendingRevealHandled?.();
  }, [
    entries,
    indexRefreshing,
    onPendingRevealHandled,
    onRequestTreeOpen,
    pendingReveal,
  ]);
  return { ...gutterBindings, ...inlineThreads };
}
