import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { PierDiffViewItem } from "@pier/ui/diff-view/items.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { GitReviewGenerationCallbacks } from "../../hooks/use-document-session.ts";
import {
  nextDemandPrefetchEntryKeys,
  sameStringSet,
} from "../materialization.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import {
  type ReviewDocumentDemand,
  selectBodyHydrationPriorityEntryKeys,
} from "./demand.ts";
import type { GitReviewDocumentGeneration } from "./generation.ts";
import type { GitReviewDocumentLoader } from "./loader.ts";
import {
  projectReviewLedger,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
} from "./projection.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentResource,
} from "./resource.ts";
import { publishReviewDocumentSoftCache } from "./soft-cache.ts";

export interface ReviewDocumentSyncContext {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly controller: GitReviewDocumentGeneration;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly demandPrefetchEntryKeysRef: {
    current: ReadonlySet<string>;
  };
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeysInOrder: readonly string[];
  readonly generation: number;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly indexGeneration: number;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loader: GitReviewDocumentLoader;
  previousItemsById: Map<string, PierDiffViewItem>;
  previousMemberIds: Set<string>;
  previousRevisionBySectionId: ReadonlyMap<string, string>;
  previousStickyBodyEntryKeys: string[];
  readonly projectionLocaleRef: RefObject<string>;
  readonly resourceByEntryKey: Map<string, GitReviewDocumentResource>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  /** 跨阅读面 soft-retain 发布键（不含 diffBase）。 */
  readonly softCacheScopeKey: string;
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
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
      diffBase,
      entries,
      entryKeysInOrder,
      generation,
      generationCallbacksRef,
      itemCacheKeysRef,
      itemIdsRef,
      indexGeneration,
      loader,
      projectionLocaleRef,
      resourceByEntryKey,
      setProjection,
      setViewState,
      viewStateRef,
    } = ctx;
    const protectedKey = generationCallbacksRef.current.getSelectedEntryKey();
    const next = controller.apply(change, protectedKey);
    generationCallbacksRef.current.applyFailureChanges(
      generation,
      next.failureChanges,
      next.settled
    );
    // 显示态以 controller **effective** 为准（含 soft-retain），不能只 merge
    // changedResources：loading 帧若 soft-retain 未进 changed，map 会卡在 loading，
    // 投影永久 estimate。
    const effectiveSnapshot = controller.snapshot(
      loader.getRetainedEntryKeys()
    );
    resourceByEntryKey.clear();
    for (const resource of effectiveSnapshot.resources) {
      resourceByEntryKey.set(resource.entry.entryKey, resource);
    }
    // 持续发布，供 stage 切到尚未 dispose 的兄弟面冷启动 soft-retain。
    publishReviewDocumentSoftCache(ctx.softCacheScopeKey, resourceByEntryKey);
    const retainedEntryKeys = effectiveSnapshot.retainedEntryKeys;
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
    // 正文候选：content 序上的 loaded；demand 只影响读与 retention sticky
    const bodyCandidateKeys = entryKeysInOrder.filter(
      (entryKey) => resourceByEntryKey.get(entryKey)?.kind === "loaded"
    );
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
    const allowedBodyEntryKeys = new Set(
      selectBodyHydrationPriorityEntryKeys({
        candidateEntryKeys: bodyCandidateKeys,
        demand,
        entryKeysInOrder,
        navigationPending,
        navigationReason:
          generationCallbacksRef.current.getNavigationMemberReason(),
        pinnedPrefixEntryKeys,
        previousMemberEntryKeys: ctx.previousStickyBodyEntryKeys,
        readingMode,
        selectedEntryKey: protectedKey,
      })
    );
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
                allowedBodyEntryKeys.has(entryKey) &&
                !demandPinKeys.has(entryKey)
            ),
            ...ctx.previousStickyBodyEntryKeys.filter(
              (entryKey) =>
                allowedBodyEntryKeys.has(entryKey) &&
                !demandPinKeys.has(entryKey)
            ),
          ]),
        ]
      : [];
    loader.setStickyMemberEntryKeys(stickyOnly);
    ctx.previousStickyBodyEntryKeys = [...allowedBodyEntryKeys];

    // 显示集 = 全部 content 槽（ledger 内挂 estimate）；demand 只影响 body 水合优先级
    const nextProjection = projectReviewLedger({
      allowedBodyEntryKeys,
      authoritativeEntryKeys: controller.authoritativeEntryKeys(),
      context,
      diffBase,
      entries,
      locale: projectionLocaleRef.current,
      resourceByEntryKey,
      sourceIndexGeneration: indexGeneration,
    });
    const previousItemsSnapshot = ctx.previousItemsById;
    const contentUpdates = nextProjection.items.filter((item) => {
      const previous = previousItemsSnapshot.get(item.id);
      // 含 previous 缺失：新 section 首帧 loaded 也必须 apply（仅依赖 membership 会漏）
      return (
        previous === undefined || !areReviewProjectionItemsEqual(previous, item)
      );
    });
    // 仅「真正文变更」才走 updateItems（新 id 的 estimate→estimate 不灌 Pierre）
    const bodyContentUpdates = contentUpdates.filter((item) => {
      const previous = previousItemsSnapshot.get(item.id);
      if (item.kind === "loaded" || item.kind === "error") {
        return true;
      }
      if (item.kind === "ready-notice") {
        return (
          previous?.kind !== "ready-notice" ||
          previous.stateNotice !== item.stateNotice
        );
      }
      // estimate：仅在从非 estimate 退回时才更新
      return previous !== undefined && previous.kind !== "estimate";
    });
    const needsImmediateFlush = bodyContentUpdates.some((item) => {
      const previous = previousItemsSnapshot.get(item.id);
      if (item.kind === "loaded" || item.kind === "error") {
        return previous?.kind === "estimate" || previous === undefined;
      }
      return item.kind === "ready-notice";
    });
    const nextMemberIds = nextProjection.items.map((item) => item.id);
    const previousIdList = itemIdsRef.current;
    const membershipOrOrderChanged =
      nextMemberIds.length !== previousIdList.length ||
      nextMemberIds.some((id, index) => id !== previousIdList[index]);
    const revisionChanged = !sameStringMap(
      ctx.previousRevisionBySectionId,
      nextProjection.revisionBySectionId
    );
    const needsReactProjection =
      membershipOrOrderChanged || contentUpdates.length > 0 || revisionChanged;
    ctx.previousMemberIds = new Set(nextMemberIds);
    ctx.previousItemsById = new Map(
      nextProjection.items.map((item) => [item.id, item])
    );
    ctx.previousRevisionBySectionId = nextProjection.revisionBySectionId;
    // 无拓扑/正文变化：仍更新 viewState 元数据，跳过 setProjection
    if (!needsReactProjection) {
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
    for (const item of nextProjection.items) {
      itemCacheKeysRef.current.set(item.id, item.cacheKey);
    }
    if (needsReactProjection) {
      itemIdsRef.current = nextMemberIds;
      setProjection(nextProjection);
    }
    if (bodyContentUpdates.length > 0) {
      generationCallbacksRef.current.recordLatestItemUpdates(
        bodyContentUpdates
      );
      generationCallbacksRef.current.notifyProjectionChanged(
        bodyContentUpdates.map((item) => item.id)
      );
      const handle = diffHandleRef.current;
      if (handle && committedProjectionGenerationRef.current === generation) {
        // estimate→loaded / error / notice：立刻 flush，禁止 rAF 迟到导致首屏假空
        generationCallbacksRef.current.applyItemUpdates(
          handle,
          generation,
          bodyContentUpdates,
          next.settled || navigationPending || needsImmediateFlush
            ? {
                ...(next.settled || needsImmediateFlush ? { flush: true } : {}),
                ...(navigationPending ? { preserveAnchor: true } : {}),
              }
            : undefined
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

export function areReviewProjectionItemsEqual(
  left: PierDiffViewItem,
  right: PierDiffViewItem
): boolean {
  return (
    left.cacheKey === right.cacheKey &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.patch === right.patch &&
    left.stateNotice === right.stateNotice &&
    left.fileDisplay?.path === right.fileDisplay?.path &&
    left.fileDisplay?.previousPath === right.fileDisplay?.previousPath &&
    left.fileDisplay?.status === right.fileDisplay?.status &&
    left.stageControl?.busy === right.stageControl?.busy &&
    left.stageControl?.canDiscard === right.stageControl?.canDiscard &&
    left.stageControl?.state === right.stageControl?.state &&
    left.stageControl?.targetSectionKey ===
      right.stageControl?.targetSectionKey &&
    sameChangeControls(left.changeControls, right.changeControls)
  );
}

function sameChangeControls(
  left: PierDiffViewItem["changeControls"],
  right: PierDiffViewItem["changeControls"]
): boolean {
  if (left === right) {
    return true;
  }
  if (left?.length !== right?.length) {
    return false;
  }
  return (left ?? []).every((control, index) => {
    const candidate = right?.[index];
    return (
      candidate !== undefined &&
      control.busy === candidate.busy &&
      control.canRevert === candidate.canRevert &&
      control.changeBlockIndex === candidate.changeBlockIndex &&
      control.changeKey === candidate.changeKey &&
      control.hunkIndex === candidate.hunkIndex &&
      control.state === candidate.state &&
      control.targetSectionKey === candidate.targetSectionKey
    );
  });
}

function sameStringMap(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}
