import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { type RefObject, useLayoutEffect, useMemo } from "react";
import {
  indexReviewDocumentProjection,
  indexReviewEntrySections,
  type ReviewDocumentProjection,
} from "./git-review-document-projection.ts";

/** 将 React 投影一次性提交给导航索引、cacheKey 索引和当前 Pierre handle。 */
export function useGitReviewProjectionCommit({
  committedProjectionGenerationRef,
  diffHandleRef,
  documentGenerationRef,
  entries,
  entryKeyBySectionIdRef,
  firstSectionIdByEntryKeyRef,
  itemCacheKeysRef,
  itemIdsRef,
  itemIndexByIdRef,
  latestItemUpdatesRef,
  notifyProjectionChanged,
  projection,
  projectionGeneration,
  renderedGenerationRef,
  replayLatestItemUpdates,
  resumeSelectedNavigation,
  tryPendingNavigation,
}: {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly itemIndexByIdRef: RefObject<ReadonlyMap<string, number>>;
  readonly latestItemUpdatesRef: RefObject<Map<string, PierDiffViewItem>>;
  readonly notifyProjectionChanged: (ids?: readonly string[]) => void;
  readonly projection: ReviewDocumentProjection;
  readonly projectionGeneration: number;
  readonly renderedGenerationRef: RefObject<number>;
  readonly replayLatestItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    allowedIds?: readonly string[]
  ) => boolean;
  readonly resumeSelectedNavigation: () => void;
  readonly tryPendingNavigation: () => void;
}): void {
  const projectionIndex = useMemo(
    () => indexReviewDocumentProjection(projection),
    [projection]
  );
  const entrySectionIndex = useMemo(
    () => indexReviewEntrySections(entries),
    [entries]
  );

  useLayoutEffect(() => {
    committedProjectionGenerationRef.current = projectionGeneration;
    entryKeyBySectionIdRef.current = projection.entryKeyBySectionId;
    // firstSection 来自全量 entries，保证 idle 树点击可解析 sectionId。
    firstSectionIdByEntryKeyRef.current = entrySectionIndex;
    itemIndexByIdRef.current = projectionIndex.itemIndexById;
    const cacheKeys = new Map(projectionIndex.itemCacheKeys);
    for (const item of latestItemUpdatesRef.current.values()) {
      cacheKeys.set(item.id, item.cacheKey);
    }
    itemCacheKeysRef.current = cacheKeys;
    itemIdsRef.current = projectionIndex.itemIds;
    if (projectionGeneration !== documentGenerationRef.current) {
      return;
    }
    const handle = diffHandleRef.current;
    if (handle) {
      replayLatestItemUpdates(
        handle,
        projectionGeneration,
        projectionIndex.itemIds
      );
    }
    renderedGenerationRef.current = projectionGeneration;
    notifyProjectionChanged();
    resumeSelectedNavigation();
    tryPendingNavigation();
  }, [
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    entrySectionIndex,
    firstSectionIdByEntryKeyRef,
    itemCacheKeysRef,
    itemIdsRef,
    itemIndexByIdRef,
    latestItemUpdatesRef,
    notifyProjectionChanged,
    projection.entryKeyBySectionId,
    projectionGeneration,
    projectionIndex,
    renderedGenerationRef,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    tryPendingNavigation,
  ]);
}
