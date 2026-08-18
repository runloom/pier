import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { isPreviewableReviewImagePath } from "@shared/git-review/previewable-image.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import { reviewGroupsForSurface } from "../surface-group.ts";
import {
  orderReviewPresentationSlots,
  reviewPresentationEntryKeysInOrder,
} from "./presentation-order.ts";

/**
 * 槽位正文资格（金标准 bodyClass）。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §4
 *
 * - content → 进入 CodeView / materialize 主路径
 * - notice（非预览二进制）→ 进入 CodeView 说明卡，**不** materialize patch
 * - meta / unknown → 不进正文、不进重队列
 */
export type ReviewSlotBodyClass = "content" | "meta" | "notice" | "unknown";

type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];
type ReviewSlotLike = Pick<
  ReviewSlot,
  "additions" | "binary" | "deletions" | "status"
> & {
  readonly oldPath?: string | null;
  readonly targetPath?: string;
};

/**
 * - 明确 0+0 或纯路径 rename → meta（含预览图片的路径-only rename）
 * - previewable raster image (png/jpeg/gif/webp) → content even when binary
 * - other binary（含非预览二进制 rename）→ notice（进列表说明卡，不拉 patch）
 * - 其余有改动状态 → content
 * - 缺证据 → unknown（不进正文）
 */
export function classifyReviewSlotBodyClass(
  slot: ReviewSlotLike
): ReviewSlotBodyClass {
  const additions = slot.additions;
  const deletions = slot.deletions;
  const hasLineStats =
    typeof additions === "number" && typeof deletions === "number";
  const hasEdits = hasLineStats && additions + deletions > 0;

  if (slot.binary === true) {
    const imagePath = slot.targetPath ?? slot.oldPath ?? "";
    if (isPreviewableReviewImagePath(imagePath)) {
      // 可预览图片的路径-only rename 与文本 rename 一样不进正文。
      if (slot.status === "renamed" && !hasEdits) {
        return "meta";
      }
      return "content";
    }
    return "notice";
  }

  if (slot.status === "renamed" && !hasEdits) {
    return "meta";
  }

  if (hasLineStats && additions + deletions === 0) {
    if (slot.status === "conflicted") {
      return "content";
    }
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

/** 是否进入正文表面（CodeView 成员 / pending 骨架）。二进制 notice 与文本同列。 */
export function isReviewSlotIncludedInBody(slot: ReviewSlotLike): boolean {
  const bodyClass = classifyReviewSlotBodyClass(slot);
  return bodyClass === "content" || bodyClass === "notice";
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

/** 是否允许进入 document materialize 队列（仅 content；notice 用 index 说明卡）。 */
export function isReviewEntryBodyHydratable(
  entry: GitReviewIndexEntry,
  diffBase?: GitReviewReadingSurface
): boolean {
  const slots =
    diffBase === undefined
      ? entry.renderSlots
      : entry.renderSlots.filter((slot) =>
          reviewGroupsForSurface(diffBase).includes(slot.group)
        );
  return slots.some((slot) => classifyReviewSlotBodyClass(slot) === "content");
}

/** 当前面下 content-bearing entryKey 序（seed / demand 主路径）。 */
export function reviewContentEntryKeysInOrder(
  entries: readonly GitReviewIndexEntry[],
  diffBase?: GitReviewReadingSurface,
  /**
   * Same factory as the sidebar tree. Prefer always passing it so collision
   * displayPath order matches CodeView under non-en locales.
   */
  collidingFileLabel?: (name: string) => string
): string[] {
  const groups =
    diffBase === undefined ? undefined : reviewGroupsForSurface(diffBase);
  // includeSlot filters after full-group collision geometry (presentation-order).
  const ordered = orderReviewPresentationSlots(entries, {
    ...(collidingFileLabel === undefined ? {} : { collidingFileLabel }),
    ...(groups === undefined ? {} : { groups }),
    includeSlot: (slot) => classifyReviewSlotBodyClass(slot) === "content",
  });
  return reviewPresentationEntryKeysInOrder(ordered);
}
