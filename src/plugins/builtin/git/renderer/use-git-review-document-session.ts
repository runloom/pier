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
  type PendingReviewAnchor,
  projectReviewDocumentResource,
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
    const scopeKey = JSON.stringify([scope.contextId, scope.gitRootPath]);
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
    // 金标准：代际接受时一次投全量轻量槽；同代只 sparse 正文更新，绝不因 load 改拓扑。
    const initialProjection = projectReviewDocuments(
      initialSnapshot,
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
      // demand 预取覆盖只服务 seed/window/lookahead；CodeView 成员始终=全量轻量槽。
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
      // 同代拓扑冻结：只 sparse update 已变化 entry 的正文/占位 cacheKey。
      const itemUpdates = next.changedResources.flatMap(
        (resource) =>
          projectReviewDocumentResource(
            resource,
            context,
            projectionLocaleRef.current
          ).items
      );
      if (itemUpdates.length > 0) {
        for (const item of itemUpdates) {
          itemCacheKeysRef.current.set(item.id, item.cacheKey);
        }
        generationCallbacksRef.current.recordLatestItemUpdates(itemUpdates);
        generationCallbacksRef.current.notifyProjectionChanged(
          itemUpdates.map((item) => item.id)
        );
        // 稀疏正文必须回写 React projection。否则 CodeView remount /
        // 虚拟化重建只会看到代际初的 placeholder，刷新失败后正文“消失”。
        setProjection((previous) => {
          if (previous.items.length === 0) {
            return previous;
          }
          const byId = new Map(itemUpdates.map((item) => [item.id, item]));
          let changed = false;
          const items = previous.items.map((item) => {
            const next = byId.get(item.id);
            if (!next || next.cacheKey === item.cacheKey) {
              return item;
            }
            changed = true;
            return next;
          });
          return changed
            ? {
                entryKeyBySectionId: previous.entryKeyBySectionId,
                items,
              }
            : previous;
        });
        const handle = diffHandleRef.current;
        if (handle && committedProjectionGenerationRef.current === generation) {
          generationCallbacksRef.current.applyItemUpdates(
            handle,
            generation,
            itemUpdates
          );
          // ready 正文到达后立刻续跑导航。
          generationCallbacksRef.current.tryPendingNavigation();
        }
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
