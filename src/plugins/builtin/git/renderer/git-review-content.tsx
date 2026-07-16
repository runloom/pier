import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReviewRenderFeedback } from "./git-review-code-view.tsx";
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
  type PendingReviewAnchor,
  projectReviewDocumentResource,
  projectReviewDocuments,
  resolveReviewAnchor,
} from "./git-review-document-projection.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
  useReviewAppearance,
  useReviewSelection,
} from "./git-review-document-ui-state.ts";
import { GitReviewDocumentView } from "./git-review-document-view.tsx";
import { useReviewFailureSummary } from "./git-review-failure-state.ts";
import {
  nextMaterializedEntryKeys,
  sameStringSet,
} from "./git-review-materialization.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";
import { useGitReviewDocumentDemand } from "./use-git-review-document-demand.ts";
import { useGitReviewItemReplay } from "./use-git-review-item-replay.ts";
import { useGitReviewLocaleProjection } from "./use-git-review-locale-projection.ts";
import { useGitReviewNavigation } from "./use-git-review-navigation.ts";
import { useGitReviewProjectionCommit } from "./use-git-review-projection-commit.ts";
import { useGitReviewRetentionSync } from "./use-git-review-retention-sync.ts";

function ReviewDocumentsComponent({
  context,
  entries,
  indexGeneration,
  indexRefreshFailure,
  onRetryIndex,
  scope,
  setSidebarCollapsed,
  sidebarCollapsed,
  treeModel,
  warnings,
}: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly indexGeneration: number;
  readonly indexRefreshFailure: GitReviewFailure | null;
  readonly onRetryIndex: () => void;
  readonly scope: GitReviewScope;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly warnings: GitReviewIndexOk["warnings"];
}): React.JSX.Element {
  const appearance = useReviewAppearance(context, entries.length > 0);
  const documentControllerRef = useRef<GitReviewDocumentGeneration | null>(
    null
  );
  const loaderRef = useRef<GitReviewDocumentLoader | null>(null);
  const documentGenerationRef = useRef(0);
  const diffHandleRef = useRef<PierDiffViewHandle | null>(null);
  const entryKeyBySectionIdRef = useRef<ReadonlyMap<string, string>>(new Map());
  const firstSectionIdByEntryKeyRef = useRef<ReadonlyMap<string, string>>(
    new Map()
  );
  const itemCacheKeysRef = useRef(new Map<string, string>());
  const itemIndexByIdRef = useRef<ReadonlyMap<string, number>>(new Map());
  const itemIdsRef = useRef<readonly string[]>([]);
  const pendingAnchorRef = useRef<PendingReviewAnchor | null>(null);
  const latestItemUpdatesRef = useRef(new Map<string, PierDiffViewItem>());
  const previousSnapshotRef = useRef(EMPTY_LOADER_SNAPSHOT);
  const projectedLocaleRef = useRef(appearance.locale);
  const projectionLocaleRef = useRef(appearance.locale);
  const committedProjectionGenerationRef = useRef(0);
  const renderedGenerationRef = useRef(0);
  const renderWindowRef = useRef<PierDiffViewRenderWindow | null>(null);
  const seedEntryKeysRef = useRef<readonly string[]>([]);
  const stickyMaterializedEntryKeysRef = useRef<ReadonlySet<string>>(new Set());
  const currentDemandRef = useRef<ReviewDocumentDemand>({
    bufferedEntryKeys: [],
    visibleEntryKeys: [],
  });
  const scopeKeyRef = useRef<string | null>(null);
  const viewStateRef = useRef(EMPTY_DOCUMENT_VIEW_STATE);
  const [viewState, setViewState] = useState(EMPTY_DOCUMENT_VIEW_STATE);
  const [projection, setProjection] = useState(EMPTY_REVIEW_PROJECTION);
  const [projectionGeneration, setProjectionGeneration] = useState(0);
  const [stickyVersion, setStickyVersion] = useState(0);
  const [renderFeedback, setRenderFeedback] =
    useState<ReviewRenderFeedback | null>(null);
  const { selectedEntryKey, selectedTreeEntry, setSelectedEntryKey } =
    useReviewSelection(scope, treeModel);
  const {
    applyGenerationChanges: applyFailureChanges,
    resetGenerationFailures,
    summary: failureSummary,
    updateRenderItemError,
  } = useReviewFailureSummary({
    entries,
    entryKeyBySectionIdRef,
    selectedEntryKey,
  });
  useLayoutEffect(() => {
    projectionLocaleRef.current = appearance.locale;
  }, [appearance.locale]);
  const updateRenderFeedback = useCallback(
    (feedback: ReviewRenderFeedback | null) => setRenderFeedback(feedback),
    []
  );
  const { cancelRetentionSync, syncRetentionLimits } =
    useGitReviewRetentionSync({
      controllerRef: documentControllerRef,
      documentGenerationRef,
      loaderRef,
    });
  const applyNavigationDemand = useCallback((entryKey: string) => {
    const demand = {
      bufferedEntryKeys: [] as const,
      visibleEntryKeys: [entryKey],
    };
    currentDemandRef.current = demand;
    loaderRef.current?.setWindowDemand(demand);
  }, []);
  const {
    beginGeneration,
    beginNavigation,
    cancelVerification,
    clearForUserIntent,
    getSelectedEntryKey,
    hasPendingNavigation,
    navigationError,
    navigationPending,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  } = useGitReviewNavigation({
    applyNavigationDemand,
    diffHandleRef,
    documentGenerationRef,
    firstSectionIdByEntryKeyRef,
    itemCacheKeysRef,
    itemIndexByIdRef,
    loaderRef,
    pendingAnchorRef,
    renderedGenerationRef,
  });
  const requestRenderWindow = useGitReviewDocumentDemand({
    currentDemandRef,
    entries,
    entryKeyBySectionIdRef,
    getSelectedEntryKey,
    hasPendingNavigation,
    loaderRef,
    navigationPending,
    renderWindowRef,
    seedEntryKeysRef,
    stickyMaterializedEntryKeysRef,
    stickyVersion,
  });
  const {
    applyItemUpdates,
    clearLatestItemUpdates,
    replayFailure,
    recordLatestItemUpdates,
    replayLatestItemUpdates,
    retryLatestItemUpdates,
  } = useGitReviewItemReplay({
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    hasPendingNavigation,
    latestItemUpdatesRef,
  });
  const generationCallbacksRef = useRef({
    applyFailureChanges,
    applyItemUpdates,
    beginGeneration,
    cancelRetentionSync,
    clearLatestItemUpdates,
    getSelectedEntryKey,
    hasPendingNavigation,
    notifyProjectionChanged,
    recordLatestItemUpdates,
    resetGenerationFailures,
    syncRetentionLimits,
    tryPendingNavigation,
  });
  generationCallbacksRef.current = {
    applyFailureChanges,
    applyItemUpdates,
    beginGeneration,
    cancelRetentionSync,
    clearLatestItemUpdates,
    getSelectedEntryKey,
    hasPendingNavigation,
    notifyProjectionChanged,
    recordLatestItemUpdates,
    resetGenerationFailures,
    syncRetentionLimits,
    tryPendingNavigation,
  };

  useEffect(() => {
    const generation = Math.max(
      documentGenerationRef.current + 1,
      indexGeneration + 1
    );
    documentGenerationRef.current = generation;
    const scopeKey = JSON.stringify([scope.contextId, scope.gitRootPath]);
    const retainPrevious = scopeKeyRef.current === scopeKey;
    scopeKeyRef.current = scopeKey;
    const entryKeysInOrder = entries.map((entry) => entry.entryKey);
    const currentEntryKeys = new Set(entryKeysInOrder);
    const seedEntryKeys = gitReviewSeedEntryKeys(entryKeysInOrder);
    seedEntryKeysRef.current = seedEntryKeys;
    stickyMaterializedEntryKeysRef.current = new Set();
    currentDemandRef.current = {
      bufferedEntryKeys: [],
      visibleEntryKeys: [],
    };
    const selectedEntryKey = generationCallbacksRef.current.beginGeneration(
      retainPrevious ? currentEntryKeys : new Set(),
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
    const previousByEntryKey = new Map(
      (retainPrevious ? previousSnapshot.retainedEntryKeys : []).flatMap(
        (entryKey) => {
          const resource = previousResources.get(entryKey);
          return resource && currentEntryKeys.has(entryKey)
            ? ([[entryKey, resource]] as const)
            : [];
        }
      )
    );
    const anchor =
      retainPrevious && !generationCallbacksRef.current.hasPendingNavigation()
        ? diffHandleRef.current?.captureTopAnchor()
        : null;
    pendingAnchorRef.current = anchor
      ? {
          anchor,
          entryKey: entryKeyBySectionIdRef.current.get(anchor.id) ?? null,
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
    // 金标准：代际接受时一次投全量轻量槽；同代只 sparse 正文更新，绝不因 load 改拓扑。
    const initialProjection = projectReviewDocuments(
      initialViewState.snapshot,
      context,
      projectionLocaleRef.current
    );
    const initialResourceByEntryKey = new Map(
      initialViewState.snapshot.resources.map((resource) => [
        resource.entry.entryKey,
        resource,
      ])
    );
    stickyMaterializedEntryKeysRef.current = new Set(
      nextMaterializedEntryKeys({
        demand: {
          bufferedEntryKeys: [],
          visibleEntryKeys: seedEntryKeys,
        },
        entryKeysInOrder,
        previous: new Set(),
        retainedEntryKeys: new Set(initialViewState.snapshot.retainedEntryKeys),
        resourceByEntryKey: initialResourceByEntryKey,
        selectedEntryKey,
      })
    );
    projectedLocaleRef.current = projectionLocaleRef.current;
    const lightViewState = {
      generation: initialViewState.generation,
      snapshot: {
        resources: [],
        retainedEntryKeys: initialViewState.snapshot.retainedEntryKeys,
        settled: initialViewState.snapshot.settled,
      },
      staleRetainedCount: initialViewState.staleRetainedCount,
    };
    viewStateRef.current = lightViewState;
    setViewState(lightViewState);
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
      // sticky/materialized 只服务 demand/lookahead 与回收启发式，绝不决定 CodeView 成员（成员=全量轻量槽）。
      const stickyLookup = new Map<string, GitReviewDocumentResource>();
      for (const entryKey of stickyMaterializedEntryKeysRef.current) {
        const resource = resourceByEntryKey.get(entryKey);
        if (resource) {
          stickyLookup.set(entryKey, resource);
        }
      }
      for (const resource of next.changedResources) {
        stickyLookup.set(resource.entry.entryKey, resource);
      }
      const stickyKeys = nextMaterializedEntryKeys({
        allowReclaim: !generationCallbacksRef.current.hasPendingNavigation(),
        demand: currentDemandRef.current,
        entryKeysInOrder,
        previous: stickyMaterializedEntryKeysRef.current,
        retainedEntryKeys: new Set(retainedEntryKeys),
        resourceByEntryKey: stickyLookup,
        selectedEntryKey: protectedKey,
      });
      const stickySet = new Set(stickyKeys);
      if (!sameStringSet(stickyMaterializedEntryKeysRef.current, stickySet)) {
        stickyMaterializedEntryKeysRef.current = stickySet;
        setStickyVersion((value) => value + 1);
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
      const nextViewState = {
        generation,
        snapshot: {
          resources: [],
          retainedEntryKeys,
          settled: next.settled,
        },
        staleRetainedCount: next.staleRetainedCount,
      };
      const previousViewState = viewStateRef.current;
      viewStateRef.current = nextViewState;
      if (
        previousViewState.generation !== nextViewState.generation ||
        previousViewState.snapshot.settled !== nextViewState.snapshot.settled ||
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
      stickyMaterializedEntryKeys: stickyMaterializedEntryKeysRef.current,
      windowDemand,
    });
    currentDemandRef.current = finalDemand;
    loader.setWindowDemand(finalDemand);
    return () => {
      previousSnapshotRef.current = controller.snapshot(
        loader.getRetainedEntryKeys()
      );
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
  useGitReviewProjectionCommit({
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
  });
  useLayoutEffect(() => {
    viewStateRef.current = viewState;
    resumeSelectedNavigation();
    generationCallbacksRef.current.tryPendingNavigation();
  }, [resumeSelectedNavigation, viewState]);
  useGitReviewLocaleProjection({
    context,
    controllerRef: documentControllerRef,
    loaderRef,
    locale: appearance.locale,
    projectedLocaleRef,
    recordLatestItemUpdates,
    setProjection,
  });

  const setDiffHandle = useCallback(
    (handle: PierDiffViewHandle | null) => {
      diffHandleRef.current = handle;
      if (
        handle &&
        committedProjectionGenerationRef.current ===
          documentGenerationRef.current
      ) {
        replayLatestItemUpdates(handle, documentGenerationRef.current);
        generationCallbacksRef.current.tryPendingNavigation();
      }
    },
    [replayLatestItemUpdates]
  );

  const tryPendingAnchor = useCallback(() => {
    if (hasPendingNavigation()) {
      return;
    }
    const pending = pendingAnchorRef.current;
    if (!pending || pending.generation !== renderedGenerationRef.current) {
      return;
    }
    const anchor = resolveReviewAnchor(pending, itemIdsRef.current);
    if (anchor && diffHandleRef.current?.restoreAnchor(anchor)) {
      if (viewStateRef.current.snapshot.settled) {
        pendingAnchorRef.current = null;
      } else {
        pendingAnchorRef.current = { ...pending, restored: true };
      }
    } else if (viewStateRef.current.snapshot.settled) {
      pendingAnchorRef.current = null;
    }
  }, [hasPendingNavigation]);

  useEffect(() => {
    generationCallbacksRef.current.tryPendingNavigation();
    tryPendingAnchor();
  });

  useEffect(() => cancelVerification, [cancelVerification]);

  const openPath = useCallback(
    (path: string) => {
      const entry = treeModel.entryByPath.get(path);
      if (!entry) {
        return;
      }
      setSelectedEntryKey(entry.entryKey);
      beginNavigation(entry.entryKey);
      generationCallbacksRef.current.tryPendingNavigation();
    },
    [beginNavigation, setSelectedEntryKey, treeModel]
  );
  const retryFailure = useCallback(
    (entryKey: string) => {
      loaderRef.current?.retry(entryKey);
      beginNavigation(entryKey);
      generationCallbacksRef.current.tryPendingNavigation();
    },
    [beginNavigation]
  );
  const handleRenderItemError = useCallback(
    (id: string, error: Error | null) => {
      updateRenderItemError(viewState.generation, id, error);
    },
    [updateRenderItemError, viewState.generation]
  );

  return (
    <GitReviewDocumentView
      appearance={appearance}
      context={context}
      diffRef={setDiffHandle}
      failureSummary={failureSummary}
      gitRootPath={scope.gitRootPath}
      indexFailure={indexRefreshFailure}
      navigationError={navigationError}
      onFeedbackChange={updateRenderFeedback}
      onItemError={handleRenderItemError}
      onOpenPath={openPath}
      onRenderWindowChange={requestRenderWindow}
      onRetryFailure={retryFailure}
      onRetryIndex={onRetryIndex}
      onRetryNavigation={retryNavigation}
      onScroll={() => {
        clearForUserIntent();
        if (pendingAnchorRef.current?.restored) {
          pendingAnchorRef.current = null;
        }
      }}
      projection={projection}
      renderFeedback={
        renderFeedback ??
        (replayFailure
          ? { error: replayFailure, retry: retryLatestItemUpdates }
          : null)
      }
      selectedFilePath={selectedTreeEntry?.entry.path ?? null}
      selectedTreePath={selectedTreeEntry?.path ?? null}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      treeModel={treeModel}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

export const ReviewDocuments = memo(ReviewDocumentsComponent);
