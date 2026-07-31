import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import { reviewGroupsForSurface } from "../surface-group.ts";

/**
 * 槽位正文资格（金标准 bodyClass）。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §4
 *
 * - content → 进入 CodeView / materialize 主路径
 * - meta / notice / unknown → 默认不进正文、不进重队列
 */
export type ReviewSlotBodyClass = "content" | "meta" | "notice" | "unknown";

type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];
type ReviewSlotLike = Pick<
  ReviewSlot,
  "additions" | "binary" | "deletions" | "status"
>;

/**
 * - binary → notice
 * - 明确 0+0 或 pure rename → meta
 * - 其余有改动状态 → content
 * - 缺证据 → unknown（不进正文）
 */
export function classifyReviewSlotBodyClass(
  slot: ReviewSlotLike
): ReviewSlotBodyClass {
  if (slot.binary === true) {
    return "notice";
  }

  const additions = slot.additions;
  const deletions = slot.deletions;
  const hasLineStats =
    typeof additions === "number" && typeof deletions === "number";

  if (hasLineStats && additions + deletions === 0) {
    if (slot.status === "conflicted") {
      return "content";
    }
    return "meta";
  }

  if (slot.status === "renamed" && !hasLineStats) {
    return "meta";
  }

  if (
    slot.status === "modified" ||
    slot.status === "added" ||
    slot.status === "deleted" ||
    slot.status === "conflicted" ||
    slot.status === "renamed"
  ) {
    return "content";
  }

  return "unknown";
}

/** 是否进入正文表面（CodeView 成员 / pending 骨架）。 */
export function isReviewSlotIncludedInBody(
  slot: ReviewSlotLike,
  options?: { readonly includeNotice?: boolean }
): boolean {
  const bodyClass = classifyReviewSlotBodyClass(slot);
  if (bodyClass === "content") {
    return true;
  }
  if (options?.includeNotice === true && bodyClass === "notice") {
    return true;
  }
  return false;
}

export function reviewEntryHasBodyContent(
  entry: GitReviewIndexEntry,
  diffBase?: GitReviewReadingSurface
): boolean {
  const slots =
    diffBase === undefined
      ? entry.renderSlots
      : entry.renderSlots.filter((slot) =>
          reviewGroupsForSurface(diffBase).includes(slot.group)
        );
  return slots.some((slot) => isReviewSlotIncludedInBody(slot));
}

/** 是否允许进入 document materialize 队列。 */
export function isReviewEntryBodyHydratable(
  entry: GitReviewIndexEntry,
  diffBase?: GitReviewReadingSurface
): boolean {
  return reviewEntryHasBodyContent(entry, diffBase);
}

/** index 提示无文本行：强制折叠 / 禁用展开。 */
export function reviewSlotPrefersCollapsedEmpty(slot: ReviewSlotLike): boolean {
  const bodyClass = classifyReviewSlotBodyClass(slot);
  return bodyClass === "meta" || bodyClass === "notice";
}

/** 当前面下 content-bearing entryKey 序（seed / demand 主路径）。 */
export function reviewContentEntryKeysInOrder(
  entries: readonly GitReviewIndexEntry[],
  diffBase?: GitReviewReadingSurface
): string[] {
  return entries
    .filter((entry) => isReviewEntryBodyHydratable(entry, diffBase))
    .map((entry) => entry.entryKey);
}
