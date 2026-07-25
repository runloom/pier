import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import {
  composeReviewDocumentDemand,
  gitReviewSeedEntryKeys,
  type ReviewDocumentDemand,
  reviewDocumentDemandForRenderWindow,
} from "./git-review-document-demand.ts";
import {
  GitReviewDocumentGeneration,
  type ReviewFailureChange,
} from "./git-review-document-generation.ts";
import { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  isCodeViewMemberResource,
  type PendingReviewAnchor,
  projectReviewDocuments,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
} from "./git-review-document-projection.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
} from "./git-review-document-ui-state.ts";
import {
  nextDemandPrefetchEntryKeys,
  sameStringSet,
} from "./git-review-materialization.ts";
import {
  patchReviewSession,
  readReviewSession,
} from "./git-review-session-cache.ts";

// 与 content 中 generationCallbacksRef 形状对齐；回调实现保留在 content。
export interface GitReviewGenerationCallbacks {
  // 失败变更类型由 failure-state 模块拥有；此处只约束调用形状。
  applyFailureChanges: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  applyItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    items: readonly PierDiffViewItem[]
  ) => boolean;
  beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number
  ) => string | null;
  cancelRetentionSync: (controller: GitReviewDocumentGeneration) => void;
  clearLatestItemUpdates: () => void;
  getSelectedEntryKey: () => string | null;
  getSelectedSectionKey: () => string | null;
  hasPendingNavigation: () => boolean;
  notifyProjectionChanged: (ids?: readonly string[]) => void;
  recordLatestItemUpdates: (items: readonly PierDiffViewItem[]) => void;
  resetGenerationFailures: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  syncRetentionLimits: () => void;
  tryPendingNavigation: () => void;
}

export function useGitReviewDocumentSession(options: {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentControllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly indexGeneration: number;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly previousSnapshotRef: {
    current: typeof EMPTY_LOADER_SNAPSHOT;
  };
  readonly projectedLocaleRef: RefObject<string>;
  readonly projectionLocaleRef: RefObject<string>;
  readonly renderWindowRef: RefObject<PierDiffViewRenderWindow | null>;
  readonly scope: GitReviewScope;
  readonly scopeKeyRef: RefObject<string | null>;
  readonly seedEntryKeysRef: RefObject<readonly string[]>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
  readonly setProjectionGeneration: Dispatch<SetStateAction<number>>;
  readonly setDemandPrefetchVersion: Dispatch<SetStateAction<number>>;
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly demandPrefetchEntryKeysRef: RefObject<ReadonlySet<string>>;
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
}): void {
  const {
    committedProjectionGenerationRef,
    context,
    currentDemandRef,
    diffHandleRef,
    documentControllerRef,
    documentGenerationRef,
    entries,
    entryKeyBySectionIdRef,
    generationCallbacksRef,
    indexGeneration,
    itemCacheKeysRef,
    itemIdsRef,
    loaderRef,
    pendingAnchorRef,
    previousSnapshotRef,
    projectedLocaleRef,
    projectionLocaleRef,
    renderWindowRef,
    scope,
    scopeKeyRef,
    seedEntryKeysRef,
    setProjection,
    setProjectionGeneration,
    setDemandPrefetchVersion,
    setViewState,
    demandPrefetchEntryKeysRef,
    viewStateRef,
  } = options;
  // 代际 effect 只随 index/scope 重建；refs/setState 故意不进 deps。
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation lifecycle is ref-driven
  useEffect(() => {
    const generation = Math.max(
      documentGenerationRef.current + 1,
      indexGeneration + 1
    );
    documentGenerationRef.current = generation;
    const sourceKey = JSON.stringify(scope);
    // target 变化必须整代重建：entryKey 只含路径，跨 target 的正文不可复用。
    const scopeKey = JSON.stringify([
      scope.contextId,
      scope.gitRootPath,
      scope.target,
    ]);
    const retainPrevious = scopeKeyRef.current === scopeKey;
    scopeKeyRef.current = scopeKey;
    const session = readReviewSession(sourceKey);
    const entryKeysInOrder = entries.map((entry) => entry.entryKey);
    const currentEntryKeys = new Set(entryKeysInOrder);
    const seedEntryKeys = gitReviewSeedEntryKeys(entryKeysInOrder);
    seedEntryKeysRef.current = seedEntryKeys;
    demandPrefetchEntryKeysRef.current = new Set();
    currentDemandRef.current = {
      bufferedEntryKeys: [],
      visibleEntryKeys: [],
    };
    const selectedEntryKey = generationCallbacksRef.current.beginGeneration(
      retainPrevious || session?.selectedEntryKey
        ? currentEntryKeys
        : new Set(),
      generation
    );
    const previousSnapshot = previousSnapshotRef.current;
    previousSnapshotRef.current = EMPTY_LOADER_SNAPSHOT;
    const previousResources = new Map(
      (retainPrevious ? previousSnapshot.resources : [])
        .filter(
          (
            resource
          ): resource is Extract<
            GitReviewDocumentResource,
            { kind: "loaded" }
          > => resource.kind === "loaded"
        )
        .map((resource) => [resource.entry.entryKey, resource])
    );
    let previousByEntryKey = new Map(
      (retainPrevious ? previousSnapshot.retainedEntryKeys : []).flatMap(
        (entryKey) => {
          const resource = previousResources.get(entryKey);
          return resource && currentEntryKeys.has(entryKey)
            ? ([[entryKey, resource]] as const)
            : [];
        }
      )
    );
    if (!retainPrevious && session?.loadedByEntryKey) {
      previousByEntryKey = new Map(
        [...session.loadedByEntryKey.entries()].flatMap(
          ([entryKey, resource]) =>
            currentEntryKeys.has(entryKey)
              ? ([[entryKey, resource]] as const)
              : []
        )
      );
    }
    const liveAnchor =
      retainPrevious && !generationCallbacksRef.current.hasPendingNavigation()
        ? diffHandleRef.current?.captureTopAnchor()
        : null;
    const sessionAnchor =
      !retainPrevious &&
      session?.anchor &&
      !generationCallbacksRef.current.hasPendingNavigation()
        ? session.anchor
        : null;
    const anchor = liveAnchor ?? sessionAnchor;
    pendingAnchorRef.current = anchor
      ? {
          anchor,
          entryKey:
            entryKeyBySectionIdRef.current.get(anchor.id) ??
            (sessionAnchor && session?.selectedEntryKey
              ? session.selectedEntryKey
              : null),
          generation,
          previousItemIds: itemIdsRef.current,
          restored: false,
        }
      : null;
    if (!retainPrevious) {
      viewStateRef.current = EMPTY_DOCUMENT_VIEW_STATE;
      setViewState(EMPTY_DOCUMENT_VIEW_STATE);
      setProjection(EMPTY_REVIEW_PROJECTION);
      setProjectionGeneration(0);
    }
    generationCallbacksRef.current.clearLatestItemUpdates();
    const loader = new GitReviewDocumentLoader({
      cancel: (operationId) => context.git.cancelReviewRequest({ operationId }),
      entries,
      load: (entry, operationId) =>
        context.git.getReviewFileDocument({
          operationId,
          source: {
            ...scope,
            oldPaths: entry.oldPaths,
            path: entry.path,
          },
        }),
    });
    if (!retainPrevious && session && session.loadedByEntryKey.size > 0) {
      loader.hydrateLoaded(session.loadedByEntryKey);
    }
    loaderRef.current = loader;
    const controller = new GitReviewDocumentGeneration({
      current: loader.getSnapshot(),
      generation,
      previousByEntryKey,
      protectedEntryKey: selectedEntryKey,
    });
    documentControllerRef.current = controller;
    loader.setRetentionLimits(controller.retentionLimits());
    const initialViewState = controller.initialViewState();
    // 真资源只在 controller；UI viewState 仅 meta。
    const initialSnapshot = controller.snapshot(loader.getRetainedEntryKeys());
    // 终态：CodeView 只收 loaded/error 真成员；idle 不进列表。
    const initialProjection = projectReviewDocuments(
      {
        ...initialSnapshot,
        resources: initialSnapshot.resources.filter(isCodeViewMemberResource),
      },
      context,
      projectionLocaleRef.current
    );
    const initialResourceByEntryKey = new Map(
      initialSnapshot.resources.map((resource) => [
        resource.entry.entryKey,
        resource,
      ])
    );
    demandPrefetchEntryKeysRef.current = new Set(
      nextDemandPrefetchEntryKeys({
        demand: {
          bufferedEntryKeys: [],
          visibleEntryKeys: seedEntryKeys,
        },
        entryKeysInOrder,
        previous: new Set(),
        retainedEntryKeys: new Set(initialViewState.retainedEntryKeys),
        resourceByEntryKey: initialResourceByEntryKey,
        selectedEntryKey,
      })
    );
    projectedLocaleRef.current = projectionLocaleRef.current;
    const uiViewState: ReviewDocumentViewState = {
      generation: initialViewState.generation,
      retainedEntryKeys: initialViewState.retainedEntryKeys,
      settled: initialViewState.settled,
      staleRetainedCount: initialViewState.staleRetainedCount,
    };
    viewStateRef.current = uiViewState;
    setViewState(uiViewState);
    setProjection(initialProjection);
    setProjectionGeneration(generation);
    generationCallbacksRef.current.resetGenerationFailures(
      generation,
      controller.initialFailureChanges()
    );
    const resourceByEntryKey = new Map(initialResourceByEntryKey);
    let previousMemberIds = new Set(
      initialProjection.items.map((item) => item.id)
    );
    const previousCacheKeys = new Map(
      initialProjection.items.map((item) => [item.id, item.cacheKey] as const)
    );
    const sync = (change: Parameters<typeof controller.apply>[0]) => {
      const protectedKey = generationCallbacksRef.current.getSelectedEntryKey();
      const next = controller.apply(change, protectedKey);
      generationCallbacksRef.current.applyFailureChanges(
        generation,
        next.failureChanges
      );
      for (const resource of next.changedResources) {
        resourceByEntryKey.set(resource.entry.entryKey, resource);
      }
      const retainedEntryKeys = loader.getRetainedEntryKeys();
      // demand 预取覆盖 seed/window/lookahead；CodeView 成员=已 materialize 集合。
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
        allowReclaim: !generationCallbacksRef.current.hasPendingNavigation(),
        demand: currentDemandRef.current,
        entryKeysInOrder,
        previous: demandPrefetchEntryKeysRef.current,
        retainedEntryKeys: new Set(retainedEntryKeys),
        resourceByEntryKey: prefetchLookup,
        selectedEntryKey: protectedKey,
      });
      const prefetchSet = new Set(prefetchKeys);
      if (!sameStringSet(demandPrefetchEntryKeysRef.current, prefetchSet)) {
        demandPrefetchEntryKeysRef.current = prefetchSet;
        setDemandPrefetchVersion((value) => value + 1);
      }
      // 终态：按当前全量成员重建投影（允许拓扑随 materialize 增长，禁止假槽）。
      const memberResources = entryKeysInOrder.flatMap((entryKey) => {
        const resource = resourceByEntryKey.get(entryKey);
        return resource && isCodeViewMemberResource(resource) ? [resource] : [];
      });
      const nextProjection = projectReviewDocuments(
        {
          resources: memberResources,
          retainedEntryKeys,
          settled: next.settled,
        },
        context,
        projectionLocaleRef.current
      );
      // 稀疏 update 仅针对已在 handle 中的 id；新成员靠 React items 拓扑提交。
      const contentUpdates = nextProjection.items.filter(
        (item) =>
          previousMemberIds.has(item.id) &&
          previousCacheKeys.get(item.id) !== item.cacheKey
      );
      const membershipChanged =
        nextProjection.items.length !== previousMemberIds.size ||
        nextProjection.items.some((item) => !previousMemberIds.has(item.id));
      previousMemberIds = new Set(nextProjection.items.map((item) => item.id));
      previousCacheKeys.clear();
      for (const item of nextProjection.items) {
        previousCacheKeys.set(item.id, item.cacheKey);
        itemCacheKeysRef.current.set(item.id, item.cacheKey);
      }
      setProjection(nextProjection);
      if (contentUpdates.length > 0) {
        generationCallbacksRef.current.recordLatestItemUpdates(contentUpdates);
        generationCallbacksRef.current.notifyProjectionChanged(
          contentUpdates.map((item) => item.id)
        );
        const handle = diffHandleRef.current;
        if (handle && committedProjectionGenerationRef.current === generation) {
          generationCallbacksRef.current.applyItemUpdates(
            handle,
            generation,
            contentUpdates
          );
        }
      }
      if (membershipChanged || contentUpdates.length > 0) {
        // 新成员进入投影后由 layout commit 续跑导航；此处再兜底一次。
        generationCallbacksRef.current.tryPendingNavigation();
      }
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
        previousViewState.staleRetainedCount !==
          nextViewState.staleRetainedCount
      ) {
        setViewState(nextViewState);
      }
      generationCallbacksRef.current.syncRetentionLimits();
    };
    const unsubscribe = loader.subscribe(sync);
    loader.setProtectedEntryKey(selectedEntryKey);
    const renderWindow = renderWindowRef.current;
    const windowDemand =
      renderWindow === null
        ? { bufferedEntryKeys: [], visibleEntryKeys: [] }
        : reviewDocumentDemandForRenderWindow(
            initialProjection.entryKeyBySectionId,
            currentEntryKeys,
            renderWindow
          );
    const finalDemand = composeReviewDocumentDemand({
      entryKeysInOrder,
      navigationPending: generationCallbacksRef.current.hasPendingNavigation(),
      seedEntryKeys,
      selectedEntryKey,
      demandPrefetchEntryKeys: demandPrefetchEntryKeysRef.current,
      windowDemand,
    });
    currentDemandRef.current = finalDemand;
    loader.setWindowDemand(finalDemand);
    return () => {
      const snap = controller.snapshot(loader.getRetainedEntryKeys());
      previousSnapshotRef.current = snap;
      const loaded = new Map(
        snap.resources
          .filter(
            (
              resource
            ): resource is Extract<
              GitReviewDocumentResource,
              { kind: "loaded" }
            > => resource.kind === "loaded"
          )
          .map((resource) => [resource.entry.entryKey, resource])
      );
      patchReviewSession(sourceKey, {
        loadedByEntryKey: loaded,
        retainedEntryKeys: loader.getRetainedEntryKeys(),
        selectedEntryKey: generationCallbacksRef.current.getSelectedEntryKey(),
        selectedSectionKey:
          generationCallbacksRef.current.getSelectedSectionKey(),
        anchor: diffHandleRef.current?.captureTopAnchor() ?? null,
      });
      unsubscribe();
      loader.dispose();
      if (documentControllerRef.current === controller) {
        documentControllerRef.current = null;
      }
      if (loaderRef.current === loader) {
        loaderRef.current = null;
      }
      generationCallbacksRef.current.cancelRetentionSync(controller);
    };
    // 代际 effect 只应随 index/scope 重建。回调一律走 ref，避免 seed 重复灌读。
  }, [context, entries, indexGeneration, scope]);
}
