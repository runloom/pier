import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { GIT_REVIEW_GROUP_ORDER } from "@shared/contracts/git/review.ts";
import { reviewTreeSectionKeyForSurface } from "../review/document/projection-index.ts";
import { reviewSurfaceForGroup } from "../review/surface-group.ts";
import type { PendingCommentReveal } from "../review/surface-types.ts";

const GROUP_FALLBACK_ORDER = ["unstaged", "staged", "conflict"] as const;

/**
 * 解析 pendingReveal → (group, sectionKey)。
 * - 默认（allowGroupFallback 假/省略）：只认显式 group。
 * - allowGroupFallback：优先 preferred group，再按 unstaged→staged→conflict 回退。
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

export type PendingRevealPlan =
  | {
      readonly kind: "open";
      readonly entryKey: string;
      readonly group: GitReviewGroup;
      readonly line: number;
      readonly sectionKey: string;
      readonly side: "new" | "old";
    }
  | { readonly kind: "wait" }
  | { readonly kind: "consume" };

/**
 * 决定 pendingReveal 如何处理（纯函数，便于单测）。
 *
 * - open：path+group 可解析 → 打开并消费
 * - wait：index 刷新中且尚未命中 → 保留 intent 等下一轮 entries
 * - consume：index 稳定仍 miss → 丢弃 intent（避免 params 卡死）
 *
 * 空工作区（无 ReviewDocuments）由 changes-panel 清空 pendingReveal，不经此路径。
 */
export function planPendingReveal(
  pending: PendingCommentReveal,
  entries: readonly GitReviewIndexEntry[],
  indexRefreshing: boolean
): PendingRevealPlan {
  const entry = entries.find((item) => item.path === pending.path);
  if (entry === undefined) {
    return indexRefreshing ? { kind: "wait" } : { kind: "consume" };
  }
  const resolved = resolvePendingRevealTarget(entry, pending);
  if (resolved === null) {
    return indexRefreshing ? { kind: "wait" } : { kind: "consume" };
  }
  return {
    kind: "open",
    entryKey: entry.entryKey,
    group: resolved.group,
    line: pending.line,
    sectionKey: resolved.sectionKey,
    side: pending.side,
  };
}
