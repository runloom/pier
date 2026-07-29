import type {
  PierDiffViewHandle,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  composeReviewDocumentDemand,
  gitReviewSeedEntryKeys,
  type ReviewDocumentDemand,
  reviewDocumentDemandForRenderWindow,
  selectBodyHydrationPriorityEntryKeys,
} from "./git-review-document-demand.ts";
import { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  projectReviewLedger,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
  recordReviewRenderedHeightEstimates,
} from "./git-review-document-projection.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";
import {
  createReviewDocumentSyncHandler,
  type ReviewDocumentSyncContext,
} from "./git-review-document-session-sync.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
} from "./git-review-document-ui-state.ts";
import { nextDemandPrefetchEntryKeys } from "./git-review-materialization.ts";
import type { GitReviewReadingSurface } from "./git-review-reading-surface.ts";
import {
  ensureReviewSurfaceSession,
  patchReviewSession,
  readReviewSession,
} from "./git-review-session-cache.ts";
import type { GitReviewGenerationCallbacks } from "./use-git-review-document-session.ts";

export interface GitReviewDocumentGenerationMountOptions {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly demandPrefetchEntryKeysRef: {
    current: ReadonlySet<string>;
  };
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentControllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly indexGeneration: number;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
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
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
}

/**
 * 代际挂载：创建 loader/controller、订阅 sync、返回 dispose。
 * 由 useGitReviewDocumentSession 在 useEffect 中调用。
 */
export function mountGitReviewDocumentGeneration(
  options: GitReviewDocumentGenerationMountOptions
): () => void {
  const {
    committedProjectionGenerationRef,
    context,
    currentDemandRef,
    diffHandleRef,
    diffBase,
    documentControllerRef,
    documentGenerationRef,
    entries,
    entryKeyBySectionIdRef,
    firstSectionIdByEntryKeyRef,
    generationCallbacksRef,
    indexGeneration,
    itemCacheKeysRef,
    itemIdsRef,
    loaderRef,
    previousSnapshotRef,
    projectedLocaleRef,
    projectionLocaleRef,
    renderWindowRef,
    scope,
    scopeKeyRef,
    seedEntryKeysRef,
    setProjection,
    setProjectionGeneration,
    setViewState,
    demandPrefetchEntryKeysRef,
    viewStateRef,
  } = options;

  generationCallbacksRef.current.beginReadingRefresh();
  const generation = Math.max(
    documentGenerationRef.current + 1,
    indexGeneration + 1
  );
  documentGenerationRef.current = generation;
  const sourceKey = ensureReviewSurfaceSession(scope, diffBase);
  // target 变化必须整代重建：entryKey 只含路径，跨 target 的正文不可复用。
  const scopeKey = JSON.stringify([
    scope.contextId,
    scope.gitRootPath,
    scope.target,
    diffBase,
  ]);
  const retainPrevious = scopeKeyRef.current === scopeKey;
  scopeKeyRef.current = scopeKey;
  const session = readReviewSession(sourceKey);
  const measuredEstimateLinesByPath = new Map(
    session?.measuredEstimateLinesByPath ?? []
  );
  const entryKeysInOrder = entries.map((entry) => entry.entryKey);
  const currentEntryKeys = new Set(entryKeysInOrder);
  const seedEntryKeys = gitReviewSeedEntryKeys(entryKeysInOrder);
  seedEntryKeysRef.current = seedEntryKeys;
  demandPrefetchEntryKeysRef.current = new Set();
  currentDemandRef.current = {
    bufferedEntryKeys: [],
    visibleEntryKeys: [],
  };
  // 视口所有权在 packages/ui 的 anchored apply；renderer 不采集或回放 scroll。
  // beginGeneration 依赖 section 映射；须先于其调用用新 index 预热，
  // 避免 layout commit 前用旧/空 map 误清选择或武装 orphan sectionKey。
  entryKeyBySectionIdRef.current = indexReviewSectionEntries(entries, diffBase);
  firstSectionIdByEntryKeyRef.current = indexReviewEntrySections(
    entries,
    diffBase
  );
  const selectedEntryKey = generationCallbacksRef.current.beginGeneration(
    retainPrevious || session?.selectedEntryKey ? currentEntryKeys : new Set(),
    generation,
    {
      restoreSelection:
        !retainPrevious &&
        session?.selectedEntryKey !== null &&
        session?.selectedEntryKey !== undefined &&
        session?.anchor == null,
    }
  );
  const previousSnapshot = previousSnapshotRef.current;
  previousSnapshotRef.current = EMPTY_LOADER_SNAPSHOT;
  const previousResources = new Map(
    (retainPrevious ? previousSnapshot.resources : [])
      .filter(
        (
          resource
        ): resource is Extract<GitReviewDocumentResource, { kind: "loaded" }> =>
          resource.kind === "loaded"
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
      [...session.loadedByEntryKey.entries()].flatMap(([entryKey, resource]) =>
        currentEntryKeys.has(entryKey) ? ([[entryKey, resource]] as const) : []
      )
    );
  }
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
        ...(previousByEntryKey.get(entry.entryKey)?.document.revision ===
        undefined
          ? {}
          : {
              previousRevision: previousByEntryKey.get(entry.entryKey)?.document
                .revision,
            }),
        source: {
          ...scope,
          oldPaths: entry.oldPaths,
          path: entry.path,
        },
      }),
  });
  // previousByEntryKey 仅供 controller 暂留换代首帧，禁止灌入新 loader：
  // 同路径/同槽位的正文也可能已因 stage 或编辑而改变，必须重新取权威文档。
  if (
    !retainPrevious &&
    scope.target.kind !== "uncommitted" &&
    session &&
    session.loadedByEntryKey.size > 0
  ) {
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
  const initialResourceByEntryKey = new Map(
    initialSnapshot.resources.map((resource) => [
      resource.entry.entryKey,
      resource,
    ])
  );
  const initialDemand: ReviewDocumentDemand = {
    bufferedEntryKeys: [],
    visibleEntryKeys: seedEntryKeys,
  };
  const initialBodyCandidates = entryKeysInOrder.filter(
    (entryKey) => initialResourceByEntryKey.get(entryKey)?.kind === "loaded"
  );
  const initialAllowedBodyEntryKeys = new Set(
    selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: initialBodyCandidates,
      demand: initialDemand,
      entryKeysInOrder,
      previousMemberEntryKeys: [],
      selectedEntryKey,
    })
  );
  // stable-ledger：全 index 槽进账本（estimate|loaded|error|ready-notice）
  const initialProjection = projectReviewLedger({
    allowedBodyEntryKeys: initialAllowedBodyEntryKeys,
    authoritativeEntryKeys: controller.authoritativeEntryKeys(),
    context,
    diffBase,
    entries,
    locale: projectionLocaleRef.current,
    measuredEstimateLinesByPath,
    resourceByEntryKey: initialResourceByEntryKey,
    sourceIndexGeneration: indexGeneration,
  });
  // retention sticky 仅保护已 materialize 的 entry（不再裁投影 id）
  const previousStickyBodyEntryKeys = [...initialAllowedBodyEntryKeys];
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
  const previousMemberIds = new Set(
    initialProjection.items.map((item) => item.id)
  );
  const syncCtx: ReviewDocumentSyncContext = {
    committedProjectionGenerationRef,
    context,
    diffBase,
    controller,
    currentDemandRef,
    demandPrefetchEntryKeysRef,
    diffHandleRef,
    entries,
    entryKeysInOrder,
    generation,
    indexGeneration,
    generationCallbacksRef,
    itemCacheKeysRef,
    itemIdsRef,
    loader,
    measuredEstimateLinesByPath,
    projectionLocaleRef,
    resourceByEntryKey,
    setProjection,
    setViewState,
    viewStateRef,
    previousItemsById: new Map(
      initialProjection.items.map((item) => [item.id, item])
    ),
    previousMemberIds,
    previousRevisionBySectionId: initialProjection.revisionBySectionId,
    previousStickyBodyEntryKeys,
  };
  const sync = createReviewDocumentSyncHandler(syncCtx);
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
    protectSelectedAnchor: selectedEntryKey !== null,
    demandPrefetchEntryKeys: demandPrefetchEntryKeysRef.current,
    windowDemand,
  });
  currentDemandRef.current = finalDemand;
  loader.setWindowDemand(finalDemand);
  return () => {
    recordReviewRenderedHeightEstimates(
      entries,
      diffHandleRef.current?.getRenderedItemHeights?.() ?? new Map(),
      measuredEstimateLinesByPath,
      diffBase
    );
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
      measuredEstimateLinesByPath,
      retainedEntryKeys: loader.getRetainedEntryKeys(),
      selectedEntryKey: generationCallbacksRef.current.getSelectedEntryKey(),
      selectedSectionKey:
        generationCallbacksRef.current.getSelectedSectionKey(),
      anchor: null,
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
}
