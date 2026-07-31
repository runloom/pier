import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { type RefObject, useLayoutEffect, useMemo } from "react";
import {
  indexReviewDocumentProjection,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  type ReviewDocumentProjection,
} from "../review/document/projection.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";

/** 将 React 投影一次性提交给导航索引、cacheKey 索引和当前 Pierre handle。 */
export function useGitReviewProjectionCommit({
  active,
  committedProjectionGenerationRef,
  diffHandleRef,
  diffBase,
  documentGenerationRef,
  entries,
  entryKeyBySectionIdRef,
  firstSectionIdByEntryKeyRef,
  itemCacheKeysRef,
  itemIdsRef,
  itemIndexByIdRef,
  latestItemUpdatesRef,
  projection,
  projectionGeneration,
  renderedGenerationRef,
  replayLatestItemUpdates,
  resumeSelectedNavigation,
  tryPendingNavigation,
}: {
  readonly active: boolean;
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly diffBase: GitReviewReadingSurface;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly itemIndexByIdRef: RefObject<ReadonlyMap<string, number>>;
  readonly latestItemUpdatesRef: RefObject<Map<string, PierDiffViewItem>>;
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
    () => indexReviewEntrySections(entries, diffBase),
    [diffBase, entries]
  );
  // 全量 section→entry（含未 materialize），供 demand / failure 解析。
  const fullSectionIndex = useMemo(() => {
    const merged = new Map(indexReviewSectionEntries(entries, diffBase));
    for (const [sectionId, entryKey] of projection.entryKeyBySectionId) {
      merged.set(sectionId, entryKey);
    }
    return merged;
  }, [diffBase, entries, projection.entryKeyBySectionId]);

  useLayoutEffect(() => {
    committedProjectionGenerationRef.current = projectionGeneration;
    entryKeyBySectionIdRef.current = fullSectionIndex;
    // firstSection 来自全量 entries，保证 idle 树点击可解析 sectionId。
    firstSectionIdByEntryKeyRef.current = entrySectionIndex;
    itemIndexByIdRef.current = projectionIndex.itemIndexById;
    const cacheKeys = new Map(projectionIndex.itemCacheKeys);
    for (const item of latestItemUpdatesRef.current.values()) {
      cacheKeys.set(item.id, item.cacheKey);
    }
    itemCacheKeysRef.current = cacheKeys;
    itemIdsRef.current = projectionIndex.itemIds;
    if (!active || projectionGeneration !== documentGenerationRef.current) {
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
    // 不调用无参 notifyProjectionChanged：会误抬 revision 触发 resume 排他 thrash。
    resumeSelectedNavigation();
    tryPendingNavigation();
  }, [
    active,
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    entrySectionIndex,
    firstSectionIdByEntryKeyRef,
    fullSectionIndex,
    itemCacheKeysRef,
    itemIdsRef,
    itemIndexByIdRef,
    latestItemUpdatesRef,
    projectionGeneration,
    projectionIndex,
    renderedGenerationRef,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    tryPendingNavigation,
  ]);
}
