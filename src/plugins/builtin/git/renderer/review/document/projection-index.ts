import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import { reviewGroupsForSurface } from "../surface-group.ts";
import { isReviewSlotIncludedInBody } from "./body-class.ts";
import type {
  ReviewDocumentProjection,
  ReviewDocumentProjectionIndex,
} from "./projection-types.ts";

export function indexReviewSectionEntries(
  entries: readonly GitReviewIndexEntry[],
  diffBase: GitReviewReadingSurface
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const groups = reviewGroupsForSurface(diffBase);
  for (const entry of entries) {
    for (const slot of entry.renderSlots) {
      if (!groups.includes(slot.group)) {
        continue;
      }
      map.set(slot.sectionKey, entry.entryKey);
    }
  }
  return map;
}

export function indexReviewEntrySections(
  entries: readonly GitReviewIndexEntry[],
  diffBase: GitReviewReadingSurface
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const sectionKey = reviewSurfaceSectionKey(entry, diffBase);
    if (sectionKey !== null) {
      map.set(entry.entryKey, sectionKey);
    }
  }
  return map;
}

export function reviewSurfaceSectionKey(
  entry: GitReviewIndexEntry,
  diffBase: GitReviewReadingSurface
): string | null {
  const group = groupForDiffBase(diffBase);
  // 金标准：导航优先 content 槽；无 content 则 null（不假 scroll）
  const content = entry.renderSlots.find(
    (slot) => slot.group === group && isReviewSlotIncludedInBody(slot)
  );
  if (content !== undefined) {
    return content.sectionKey;
  }
  return (
    entry.renderSlots.find((slot) => slot.group === group)?.sectionKey ?? null
  );
}

export function reviewTreeSectionKeyForSurface(
  entry: GitReviewIndexEntry,
  diffBase: GitReviewReadingSurface
): string | null {
  return reviewSurfaceSectionKey(entry, diffBase);
}

function groupForDiffBase(diffBase: GitReviewReadingSurface): GitReviewGroup {
  const group = reviewGroupsForSurface(diffBase)[0];
  if (group === undefined) {
    throw new Error(`阅读面缺少 Git 分组：${diffBase}`);
  }
  return group;
}

export function indexReviewDocumentProjection(
  projection: ReviewDocumentProjection
): ReviewDocumentProjectionIndex {
  const itemCacheKeys = new Map<string, string>();
  const itemIndexById = new Map<string, number>();
  const itemIds = projection.items.map((item, index) => {
    itemCacheKeys.set(item.id, item.cacheKey);
    itemIndexById.set(item.id, index);
    return item.id;
  });
  return { itemCacheKeys, itemIds, itemIndexById };
}
