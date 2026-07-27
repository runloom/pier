import type { PierDiffViewAnchor } from "@pier/ui/diff-view.tsx";
import type { PendingReviewAnchor } from "./git-review-document-projection.ts";
import {
  type ReviewReadingSide,
  resolveReviewReadingAnchor,
  shouldRestoreReadingAnchorExternally,
} from "./git-review-reading-anchor.ts";

/**
 * resolveReviewReadingAnchor 薄封装（默认空 side map）。
 * 新代码优先直接调 resolveReviewReadingAnchor。
 */
export function resolveReviewAnchor(
  pending: PendingReviewAnchor,
  currentItemIds: readonly string[],
  entryKeyBySectionId?: ReadonlyMap<string, string>,
  sideBySectionId?: ReadonlyMap<string, ReviewReadingSide>
): PierDiffViewAnchor | null {
  return resolveReviewReadingAnchor({
    currentItemIds,
    entryKeyBySectionId: entryKeyBySectionId ?? new Map(),
    pending: {
      anchor: pending.anchor,
      entryKey: pending.entryKey,
      preferredSide: pending.preferredSide,
      previousItemIds: pending.previousItemIds,
    },
    sideBySectionId: sideBySectionId ?? new Map(),
  });
}

/**
 * restore 结果三态：
 * - skipped：R1 纯高度，外层不抢
 * - restored：已成功内容锚 restore
 * - failed：需要 restore 但目标尚未进 CodeView（应保留 pending 重试）
 */
export type ReviewReadingRestoreResult = "skipped" | "restored" | "failed";

/**
 * P0 settle：仅 identity 丢失时内容锚 restore（R2/R4）；禁止 scrollTop 主路径。
 * 同 id 存活（含半暂存拓扑变）→ skipped，交给 Pierre 行锚（禁止外层 scrollTo 闪跳）。
 */
export function restoreReviewReadingViewport(
  handle: {
    restoreAnchor(anchor: PierDiffViewAnchor): boolean;
  },
  pending: PendingReviewAnchor,
  currentItemIds: readonly string[],
  entryKeyBySectionId: ReadonlyMap<string, string>,
  sideBySectionId: ReadonlyMap<string, ReviewReadingSide>
): ReviewReadingRestoreResult {
  if (!shouldRestoreReadingAnchorExternally(pending, currentItemIds)) {
    return "skipped";
  }
  const anchor = resolveReviewReadingAnchor({
    currentItemIds,
    entryKeyBySectionId,
    pending: {
      anchor: pending.anchor,
      entryKey: pending.entryKey,
      preferredSide: pending.preferredSide,
      previousItemIds: pending.previousItemIds,
    },
    sideBySectionId,
  });
  if (!anchor) {
    return "failed";
  }
  return handle.restoreAnchor(anchor) ? "restored" : "failed";
}

/** @deprecated 使用 restoreReviewReadingViewport */
export function restoreReviewViewportFreeze(
  handle: {
    restoreAnchor(anchor: PierDiffViewAnchor): boolean;
    setScrollTop(scrollTop: number): boolean;
  },
  pending: PendingReviewAnchor,
  currentItemIds: readonly string[],
  entryKeyBySectionId?: ReadonlyMap<string, string>,
  options?: {
    readonly preferAnchor?: boolean;
    readonly sideBySectionId?: ReadonlyMap<string, ReviewReadingSide>;
  }
): boolean {
  const result = restoreReviewReadingViewport(
    handle,
    pending,
    currentItemIds,
    entryKeyBySectionId ?? new Map(),
    options?.sideBySectionId ?? new Map()
  );
  return result === "restored";
}
