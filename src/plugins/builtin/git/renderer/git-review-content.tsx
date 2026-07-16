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
import type { ReviewDocumentDemand } from "./git-review-document-demand.ts";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  type PendingReviewAnchor,
  resolveReviewAnchor,
} from "./git-review-document-projection.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
  useReviewAppearance,
  useReviewSelection,
} from "./git-review-document-ui-state.ts";
import { GitReviewDocumentView } from "./git-review-document-view.tsx";
import { useReviewFailureSummary } from "./git-review-failure-state.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";
import { useGitReviewDocumentDemand } from "./use-git-review-document-demand.ts";
import { useGitReviewDocumentSession } from "./use-git-review-document-session.ts";
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
  const demandPrefetchEntryKeysRef = useRef<ReadonlySet<string>>(new Set());
  const currentDemandRef = useRef<ReviewDocumentDemand>({
    bufferedEntryKeys: [],
    visibleEntryKeys: [],
  });
  const scopeKeyRef = useRef<string | null>(null);
  const viewStateRef = useRef(EMPTY_DOCUMENT_VIEW_STATE);
  const [viewState, setViewState] = useState(EMPTY_DOCUMENT_VIEW_STATE);
  const [projection, setProjection] = useState(EMPTY_REVIEW_PROJECTION);
  const [projectionGeneration, setProjectionGeneration] = useState(0);
  const [demandPrefetchVersion, setDemandPrefetchVersion] = useState(0);
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
    demandPrefetchEntryKeysRef,
    demandPrefetchVersion,
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

  useGitReviewDocumentSession({
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
  });
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
      if (viewStateRef.current.settled) {
        pendingAnchorRef.current = null;
      } else {
        pendingAnchorRef.current = { ...pending, restored: true };
      }
    } else if (viewStateRef.current.settled) {
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
