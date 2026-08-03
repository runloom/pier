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

function probe(name: string, ms: number): void {
  const store = (Reflect.get(globalThis, "__pierCommitProbe") ??
    Reflect.set(globalThis, "__pierCommitProbe", {}) ??
    Reflect.get(globalThis, "__pierCommitProbe")) as Record<string, number>;
  const bag = Reflect.get(globalThis, "__pierCommitProbe") as Record<
    string,
    number
  >;
  const target = bag ?? store;
  target[name] = Math.max(target[name] ?? 0, Math.round(ms));
  target[`${name}_n`] = (target[`${name}_n`] ?? 0) + 1;
  target[`${name}_sum`] = (target[`${name}_sum`] ?? 0) + Math.round(ms);
}

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
  const projectionIndex = useMemo(() => {
    const t = performance.now();
    const value = indexReviewDocumentProjection(projection);
    probe("projectionIndex", performance.now() - t);
    return value;
  }, [projection]);
  const entrySectionIndex = useMemo(() => {
    const t = performance.now();
    const value = indexReviewEntrySections(entries, diffBase);
    probe("entrySectionIndex", performance.now() - t);
    return value;
  }, [diffBase, entries]);
  // 全量 section→entry（含未 materialize），供 demand / failure 解析。
  const fullSectionIndex = useMemo(() => {
    const t = performance.now();
    const merged = new Map(indexReviewSectionEntries(entries, diffBase));
    for (const [sectionId, entryKey] of projection.entryKeyBySectionId) {
      merged.set(sectionId, entryKey);
    }
    probe("fullSectionIndex", performance.now() - t);
    return merged;
  }, [diffBase, entries, projection.entryKeyBySectionId]);

  useLayoutEffect(() => {
    const tEffect = performance.now();
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
    const tReplay = performance.now();
    if (handle) {
      replayLatestItemUpdates(
        handle,
        projectionGeneration,
        projectionIndex.itemIds
      );
    }
    probe("replay", performance.now() - tReplay);
    renderedGenerationRef.current = projectionGeneration;
    // 不调用无参 notifyProjectionChanged：会误抬 revision 触发 resume 排他 thrash。
    resumeSelectedNavigation();
    tryPendingNavigation();
    probe("effect", performance.now() - tEffect);
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
