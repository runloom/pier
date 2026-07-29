import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import type {
  ReviewDocumentProjection,
  ReviewDocumentProjectionIndex,
} from "./git-review-document-projection-types.ts";
import type { GitReviewReadingSurface } from "./git-review-reading-surface.ts";
import { reviewGroupsForSurface } from "./git-review-surface-group.ts";

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
  return (
    entry.renderSlots.find((slot) => slot.group === group)?.sectionKey ?? null
  );
}

export function reviewTreeSectionKeyForSurface(
  entry: GitReviewIndexEntry,
  diffBase: GitReviewReadingSurface
): string | null {
  const group = groupForDiffBase(diffBase);
  return (
    entry.renderSlots.find((slot) => slot.group === group)?.sectionKey ?? null
  );
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
