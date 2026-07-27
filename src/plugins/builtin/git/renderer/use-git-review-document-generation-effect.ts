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
} from "./git-review-document-demand.ts";
import { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  isCodeViewMemberResource,
  type PendingReviewAnchor,
  projectReviewLedger,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
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
import {
  type ReviewReadingSide,
  readingSideFromStageState,
} from "./git-review-reading-anchor.ts";
import {
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
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly sideBySectionIdRef: RefObject<Map<string, ReviewReadingSide>>;
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
    setViewState,
    demandPrefetchEntryKeysRef,
    sideBySectionIdRef,
    viewStateRef,
  } = options;

  const syncSideBySectionId = (projection: ReviewDocumentProjection): void => {
    const next = new Map<string, ReviewReadingSide>();
    for (const item of projection.items) {
      next.set(item.id, readingSideFromStageState(item.stageControl?.state));
    }
    sideBySectionIdRef.current = next;
  };

  generationCallbacksRef.current.beginReadingRefresh();
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
  // 采锚必须用换代前的 section→entry 映射；新 index 写入后旧 sectionKey 可能已消失。
  const previousEntryKeyBySectionId = entryKeyBySectionIdRef.current;
  const previousItemIdsForAnchor = itemIdsRef.current;
  // beginGeneration 依赖 section 映射；须先于其调用用新 index 预热，
  // 避免 layout commit 前用旧/空 map 误清选择或武装 orphan sectionKey。
  entryKeyBySectionIdRef.current = indexReviewSectionEntries(entries);
  firstSectionIdByEntryKeyRef.current = indexReviewEntrySections(entries);
  const selectedEntryKey = generationCallbacksRef.current.beginGeneration(
    retainPrevious || session?.selectedEntryKey ? currentEntryKeys : new Set(),
    generation
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
  const liveAnchor =
    retainPrevious && !generationCallbacksRef.current.hasPendingNavigation()
      ? diffHandleRef.current?.captureTopAnchor()
      : null;
  const liveScrollTop =
    retainPrevious && !generationCallbacksRef.current.hasPendingNavigation()
      ? (diffHandleRef.current?.getScrollTop() ?? null)
      : null;
  const sessionAnchor =
    !retainPrevious &&
    session?.anchor &&
    !generationCallbacksRef.current.hasPendingNavigation()
      ? session.anchor
      : null;
  const anchor = liveAnchor ?? sessionAnchor;
  // P0：仅真实内容锚；禁止 capture 失败时用 ledger 首 id 冒充（会误跟 staged 第一槽）
  pendingAnchorRef.current =
    anchor == null
      ? null
      : {
          anchor,
          entryKey:
            previousEntryKeyBySectionId.get(anchor.id) ??
            entryKeyBySectionIdRef.current.get(anchor.id) ??
            (sessionAnchor && session?.selectedEntryKey
              ? session.selectedEntryKey
              : null),
          generation,
          preferredSide: sideBySectionIdRef.current.get(anchor.id) ?? "other",
          previousItemIds: previousItemIdsForAnchor,
          restored: false,
          scrollTop: liveScrollTop,
        };
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
  const initialResourceByEntryKey = new Map(
    initialSnapshot.resources.map((resource) => [
      resource.entry.entryKey,
      resource,
    ])
  );
  // stable-ledger：全 index 槽进账本（estimate|loaded|error|ready-notice）
  const initialProjection = projectReviewLedger({
    context,
    entries,
    locale: projectionLocaleRef.current,
    resourceByEntryKey: initialResourceByEntryKey,
  });
  // retention sticky 仅保护已 materialize 的 entry（不再裁投影 id）
  const previousStickyBodyEntryKeys = initialSnapshot.resources
    .filter(isCodeViewMemberResource)
    .map((resource) => resource.entry.entryKey);
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
  syncSideBySectionId(initialProjection);
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
  const previousCacheKeys = new Map(
    initialProjection.items.map((item) => [item.id, item.cacheKey] as const)
  );
  const syncCtx: ReviewDocumentSyncContext = {
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
    previousCacheKeys,
    previousMemberIds,
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
}
