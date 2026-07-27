import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ReviewDocumentDemand } from "./git-review-document-demand.ts";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  isCodeViewMemberResource,
  projectReviewLedger,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
} from "./git-review-document-projection.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import {
  nextDemandPrefetchEntryKeys,
  sameStringSet,
} from "./git-review-materialization.ts";
import {
  type ReviewReadingSide,
  readingSideFromStageState,
} from "./git-review-reading-anchor.ts";
import type { GitReviewGenerationCallbacks } from "./use-git-review-document-session.ts";

export interface ReviewDocumentSyncContext {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly controller: GitReviewDocumentGeneration;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly demandPrefetchEntryKeysRef: {
    current: ReadonlySet<string>;
  };
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeysInOrder: readonly string[];
  readonly generation: number;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loader: GitReviewDocumentLoader;
  previousCacheKeys: Map<string, string>;
  previousMemberIds: Set<string>;
  previousStickyBodyEntryKeys: string[];
  readonly projectionLocaleRef: RefObject<string>;
  readonly resourceByEntryKey: Map<string, GitReviewDocumentResource>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly sideBySectionIdRef: RefObject<Map<string, ReviewReadingSide>>;
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
}

function syncSideBySectionId(
  sideBySectionIdRef: RefObject<Map<string, ReviewReadingSide>>,
  projection: ReviewDocumentProjection
): void {
  const next = new Map<string, ReviewReadingSide>();
  for (const item of projection.items) {
    next.set(item.id, readingSideFromStageState(item.stageControl?.state));
  }
  sideBySectionIdRef.current = next;
}

export function createReviewDocumentSyncHandler(
  ctx: ReviewDocumentSyncContext
): (change: GitReviewDocumentLoaderChange) => void {
  return (change: GitReviewDocumentLoaderChange) => {
    const {
      committedProjectionGenerationRef,
      context,
      controller,
      currentDemandRef,
      demandPrefetchEntryKeysRef,
      diffHandleRef,
      entries,
      entryKeysInOrder,
      generation,
      generationCallbacksRef,
      itemCacheKeysRef,
      itemIdsRef,
      loader,
      projectionLocaleRef,
      resourceByEntryKey,
      setProjection,
      setViewState,
      sideBySectionIdRef,
      viewStateRef,
    } = ctx;
    const protectedKey = generationCallbacksRef.current.getSelectedEntryKey();
    const next = controller.apply(change, protectedKey);
    generationCallbacksRef.current.applyFailureChanges(
      generation,
      next.failureChanges,
      next.settled
    );
    for (const resource of next.changedResources) {
      resourceByEntryKey.set(resource.entry.entryKey, resource);
    }
    const retainedEntryKeys = loader.getRetainedEntryKeys();
    // demand 预取覆盖 window/lookahead/邻域；CodeView 成员=有界 cap 内 loaded|error。
    const prefetchLookup = new Map<string, GitReviewDocumentResource>();
    for (const entryKey of demandPrefetchEntryKeysRef.current) {
      const resource = resourceByEntryKey.get(entryKey);
      if (resource) {
        prefetchLookup.set(entryKey, resource);
      }
    }
    for (const resource of next.changedResources) {
      prefetchLookup.set(resource.entry.entryKey, resource);
    }
    const prefetchKeys = nextDemandPrefetchEntryKeys({
      allowReclaim:
        generationCallbacksRef.current.getReadingMode() === "idle" &&
        !generationCallbacksRef.current.hasPendingNavigation(),
      demand: currentDemandRef.current,
      entryKeysInOrder,
      previous: demandPrefetchEntryKeysRef.current,
      retainedEntryKeys: new Set(retainedEntryKeys),
      resourceByEntryKey: prefetchLookup,
      selectedEntryKey: protectedKey,
    });
    const prefetchSet = new Set(prefetchKeys);
    if (!sameStringSet(demandPrefetchEntryKeysRef.current, prefetchSet)) {
      // ref 即可；lookahead 组合读 currentDemand，不必 React setState 重渲染宿主。
      demandPrefetchEntryKeysRef.current = prefetchSet;
    }
    // 全量账本：id 集 = index 槽；demand 只影响读与 retention sticky
    const bodyCandidateKeys = entryKeysInOrder.filter((entryKey) => {
      const resource = resourceByEntryKey.get(entryKey);
      return resource !== undefined && isCodeViewMemberResource(resource);
    });
    const navigationPending =
      generationCallbacksRef.current.hasPendingNavigation();
    const demand = currentDemandRef.current;
    const bodyCandidateSet = new Set(bodyCandidateKeys);
    const readingMode = generationCallbacksRef.current.getReadingMode();
    const pinnedPrefixEntryKeys =
      generationCallbacksRef.current.syncReadingPinnedPrefix({
        candidates: bodyCandidateSet,
        entryKeysInOrder,
        selectedEntryKey: protectedKey,
        viewportEntryKeys: demand.visibleEntryKeys,
      });
    const demandPinKeys = new Set<string>();
    if (protectedKey !== null) {
      demandPinKeys.add(protectedKey);
    }
    for (const entryKey of demand.visibleEntryKeys) {
      demandPinKeys.add(entryKey);
    }
    for (const entryKey of demand.bufferedEntryKeys) {
      demandPinKeys.add(entryKey);
    }
    const readingProtected = readingMode !== "idle" || navigationPending;
    // sticky 仅保护 body LRU，不裁投影 id
    const stickyOnly = readingProtected
      ? [
          ...new Set([
            ...pinnedPrefixEntryKeys.filter(
              (entryKey) =>
                bodyCandidateSet.has(entryKey) && !demandPinKeys.has(entryKey)
            ),
            ...ctx.previousStickyBodyEntryKeys.filter(
              (entryKey) =>
                bodyCandidateSet.has(entryKey) && !demandPinKeys.has(entryKey)
            ),
          ]),
        ]
      : [];
    loader.setStickyMemberEntryKeys(stickyOnly);
    ctx.previousStickyBodyEntryKeys = bodyCandidateKeys;

    const changedBodyEntryKeys = new Set(
      next.changedResources
        .filter(isCodeViewMemberResource)
        .map((resource) => resource.entry.entryKey)
    );
    // 滚动热路径：无 body 变更时仍可能只需跳过（账本 id 随 index 固定）
    const nextProjection = projectReviewLedger({
      context,
      entries,
      locale: projectionLocaleRef.current,
      resourceByEntryKey,
    });
    const contentUpdates = nextProjection.items.filter((item) => {
      if (!ctx.previousMemberIds.has(item.id)) {
        return false;
      }
      if (ctx.previousCacheKeys.get(item.id) !== item.cacheKey) {
        return true;
      }
      const entryKey = nextProjection.entryKeyBySectionId.get(item.id);
      return entryKey !== undefined && changedBodyEntryKeys.has(entryKey);
    });
    const nextMemberIds = nextProjection.items.map((item) => item.id);
    const previousIdList = itemIdsRef.current;
    const membershipOrOrderChanged =
      nextMemberIds.length !== previousIdList.length ||
      nextMemberIds.some((id, index) => id !== previousIdList[index]);
    const needsReactProjection =
      membershipOrOrderChanged || contentUpdates.length > 0;
    // 无拓扑/正文变化：仍更新 viewState 元数据，跳过 setProjection
    if (
      !(needsReactProjection || changedBodyEntryKeys.size > 0) &&
      next.changedResources.length === 0
    ) {
      const nextViewStateOnly: ReviewDocumentViewState = {
        generation,
        retainedEntryKeys,
        settled: next.settled,
        staleRetainedCount: next.staleRetainedCount,
      };
      const previousViewStateOnly = viewStateRef.current;
      viewStateRef.current = nextViewStateOnly;
      if (
        previousViewStateOnly.generation !== nextViewStateOnly.generation ||
        previousViewStateOnly.settled !== nextViewStateOnly.settled ||
        previousViewStateOnly.staleRetainedCount !==
          nextViewStateOnly.staleRetainedCount
      ) {
        setViewState(nextViewStateOnly);
      }
      generationCallbacksRef.current.syncRetentionLimits();
      if (next.settled) {
        const settleHandle = diffHandleRef.current;
        if (
          settleHandle &&
          committedProjectionGenerationRef.current === generation
        ) {
          generationCallbacksRef.current.flushPendingItemUpdates(
            settleHandle,
            generation
          );
        }
        generationCallbacksRef.current.endReadingRefresh();
      }
      return;
    }
    ctx.previousMemberIds = new Set(nextMemberIds);
    ctx.previousCacheKeys.clear();
    for (const item of nextProjection.items) {
      ctx.previousCacheKeys.set(item.id, item.cacheKey);
      itemCacheKeysRef.current.set(item.id, item.cacheKey);
    }
    if (needsReactProjection) {
      itemIdsRef.current = nextMemberIds;
      setProjection(nextProjection);
    }
    // 始终刷新 side 图（含仅 contentUpdates 的路径）
    syncSideBySectionId(sideBySectionIdRef, nextProjection);
    if (contentUpdates.length > 0) {
      generationCallbacksRef.current.recordLatestItemUpdates(contentUpdates);
      generationCallbacksRef.current.notifyProjectionChanged(
        contentUpdates.map((item) => item.id)
      );
      const handle = diffHandleRef.current;
      if (handle && committedProjectionGenerationRef.current === generation) {
        // settle 帧 flush 正文，再 restore，避免 rAF 晚于外层锚二次推视口
        generationCallbacksRef.current.applyItemUpdates(
          handle,
          generation,
          contentUpdates,
          next.settled ? { flush: true } : undefined
        );
      }
    }
    // 中间帧不硬写 scrollTop：正文高度交给 Pierre 行级 anchoring。
    // 导航 scrollTo 仅在 projection commit / DiffView apply 之后（paint 前 layout），
    // 禁止在 setProjection 前 tryPending（full-alignment §3.3）。
    const nextViewState: ReviewDocumentViewState = {
      generation,
      retainedEntryKeys,
      settled: next.settled,
      staleRetainedCount: next.staleRetainedCount,
    };
    const previousViewState = viewStateRef.current;
    viewStateRef.current = nextViewState;
    if (
      previousViewState.generation !== nextViewState.generation ||
      previousViewState.settled !== nextViewState.settled ||
      previousViewState.staleRetainedCount !== nextViewState.staleRetainedCount
    ) {
      setViewState(nextViewState);
    }
    generationCallbacksRef.current.syncRetentionLimits();
    if (next.settled) {
      // 无 contentUpdates 时也冲刷上一帧挂起的 coalesce，再内容锚 restore
      const settleHandle = diffHandleRef.current;
      if (
        settleHandle &&
        committedProjectionGenerationRef.current === generation
      ) {
        generationCallbacksRef.current.flushPendingItemUpdates(
          settleHandle,
          generation
        );
      }
      generationCallbacksRef.current.endReadingRefresh();
    }
  };
}
