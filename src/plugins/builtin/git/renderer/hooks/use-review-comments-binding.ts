import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { GIT_REVIEW_GROUP_ORDER } from "@shared/contracts/git/review.ts";
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

const GROUP_FALLBACK_ORDER = ["unstaged", "staged", "conflict"] as const;

/**
 * 解析 pendingReveal → (group, sectionKey)。
 * - 评论：仅认显式 group（allowGroupFallback 假/省略）。
 * - Gutter：allowGroupFallback 时按 entry 实际 slot 在 unstaged→staged→conflict 中取首个可用。
 */
export function resolvePendingRevealTarget(
  entry: GitReviewIndexEntry,
  pending: PendingCommentReveal
): { group: GitReviewGroup; sectionKey: string } | null {
  const tryGroup = (
    group: GitReviewGroup
  ): { group: GitReviewGroup; sectionKey: string } | null => {
    const sectionKey = reviewTreeSectionKeyForSurface(
      entry,
      reviewSurfaceForGroup(group)
    );
    return sectionKey === null ? null : { group, sectionKey };
  };

  if (!pending.allowGroupFallback) {
    if (pending.group === undefined) {
      return null;
    }
    return tryGroup(pending.group);
  }

  const slotGroups = new Set(
    entry.renderSlots.map((slot) => slot.group as GitReviewGroup)
  );
  const ordered: GitReviewGroup[] = [];
  if (pending.group !== undefined && slotGroups.has(pending.group)) {
    ordered.push(pending.group);
  }
  for (const group of GROUP_FALLBACK_ORDER) {
    if (slotGroups.has(group) && !ordered.includes(group)) {
      ordered.push(group);
    }
  }
  // 保守：若 slot 含 committed 等，按产品 group 序补上
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    if (slotGroups.has(group) && !ordered.includes(group)) {
      ordered.push(group);
    }
  }
  for (const group of ordered) {
    const hit = tryGroup(group);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

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
    const resolved = resolvePendingRevealTarget(entry, pendingReveal);
    if (resolved === null) {
      return;
    }
    lastRevealNonceRef.current = pendingReveal.nonce;
    onRequestTreeOpen(entry.entryKey, resolved.sectionKey, resolved.group, {
      line: pendingReveal.line,
      side: pendingReveal.side,
    });
    onPendingRevealHandled?.();
  }, [entries, onPendingRevealHandled, onRequestTreeOpen, pendingReveal]);
  return { ...gutterBindings, ...inlineThreads };
}
