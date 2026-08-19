import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view/index.tsx";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGitReviewDocumentDemand } from "../hooks/use-document-demand.ts";
import { useGitReviewDocumentSession } from "../hooks/use-document-session.ts";
import { useGitReviewGenerationCallbacks } from "../hooks/use-generation-callbacks.ts";
import { useGitReviewItemReplay } from "../hooks/use-item-replay.ts";
import { useGitReviewMutationCommit } from "../hooks/use-mutation-commit.ts";
import { useGitReviewNavigation } from "../hooks/use-navigation.ts";
import { useGitReviewNavigationError } from "../hooks/use-navigation-error.ts";
import { useGitReviewProjectionCommit } from "../hooks/use-projection-commit.ts";
import { useGitReviewReadingCallbacks } from "../hooks/use-reading-callbacks.ts";
import { useGitReviewRenderWindowReady } from "../hooks/use-render-window-ready.ts";
import { useGitReviewRetentionSync } from "../hooks/use-retention-sync.ts";
import { useRetryDocumentsAfterIndexRefresh } from "../hooks/use-retry-after-index-refresh.ts";
import { useReviewCommentsBinding } from "../hooks/use-review-comments-binding.ts";
import { useGitReviewCommentsIntegration } from "../hooks/use-review-comments-integration.ts";
import { useGitReviewRetryFailure } from "../hooks/use-review-retry-failure.ts";
import { useGitReviewSurfaceNavigationHandoff } from "../hooks/use-surface-navigation-handoff.ts";
import { useGitReviewSurfaceSessionEntries } from "../hooks/use-surface-session-entries.ts";
import { useGitReviewTreeOpen } from "../hooks/use-tree-open.ts";
import { useGitReviewViewportEffects } from "../hooks/use-viewport-effects.ts";
import { createReviewCollidingFileLabel } from "../plugin-text.ts";
import type { ReviewRenderFeedback } from "./code-view.tsx";
import { ReviewCommentsChrome } from "./comments/chrome.tsx";
import { applyReviewNavigationDemand } from "./document/apply-navigation-demand.ts";
import { reviewEntryHasBodyContent } from "./document/body-class.ts";
import type { ReviewDocumentDemand } from "./document/demand.ts";
import type { GitReviewDocumentGeneration } from "./document/generation.ts";
import type { GitReviewDocumentLoader } from "./document/loader.ts";
import { EMPTY_DOCUMENT_VIEW_STATE } from "./document/projection.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
  useReviewAppearance,
  useReviewSelection,
} from "./document/ui-state.ts";
import { useReviewFailureSummary } from "./failure-state.ts";
import { createGitReviewReadingSession } from "./reading-session.ts";
import type { ReviewSurfaceProps } from "./surface-types.ts";
import { GitReviewSurfaceView } from "./surface-view.tsx";

function ReviewSurfaceComponent({
  active,
  activeSurface,
  context,
  diffBase,
  entries,
  indexGeneration,
  indexRefreshFailure,
  indexRefreshing = false,
  mutationAuthorityBlocked,
  navigationRequest,
  pendingReveal,
  onAcquireMutationAuthority,
  onMutationCommitted,
  onMutationTransition,
  onNavigationMaterialized,
  onPendingRevealHandled,
  onSurfaceNavigationSettled,
  onActiveChromeChange,
  onRequestTreeOpen,
  onRetryIndex,
  panelId,
  scope,
  setSidebarCollapsed,
  sidebarCollapsed,
  targetSelectionPending = false,
  treeModel,
  viewOptions,
  warnings,
}: ReviewSurfaceProps): React.JSX.Element {
  const { renderUpdatesActive, sessionEntries, surfaceEntries } =
    useGitReviewSurfaceSessionEntries({
      active,
      diffBase,
      entries,
      mutationAuthorityBlocked,
      navigationRequest,
    });
  const appearance = useReviewAppearance(context, entries.length > 0);
  // Same factory as changes-panel tree model so collision displayPath order matches sidebar / CodeView / demand / comment nav.
  const collidingFileLabel = useMemo(
    () => createReviewCollidingFileLabel(context, appearance.locale),
    [appearance.locale, context]
  );
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
  const readingSessionRef = useRef(createGitReviewReadingSession());
  const scopeKeyRef = useRef<string | null>(null);
  const viewStateRef = useRef(EMPTY_DOCUMENT_VIEW_STATE);
  const [viewState, setViewState] = useState(EMPTY_DOCUMENT_VIEW_STATE);
  const [projection, setProjection] = useState(EMPTY_REVIEW_PROJECTION);
  const [projectionGeneration, setProjectionGeneration] = useState(0);
  const [renderFeedback, setRenderFeedback] =
    useState<ReviewRenderFeedback | null>(null);
  const handleMutationCommitted = useGitReviewMutationCommit(
    onMutationCommitted,
    onMutationTransition
  );
  const { selectedEntryKey, selectedSectionKey, setSelectedTreeTarget } =
    useReviewSelection(scope, diffBase, treeModel);
  const getSelectedTreeEntryKey = useCallback(
    () => selectedEntryKey,
    [selectedEntryKey]
  );
  const getSelectedTreeSectionKey = useCallback(
    () => selectedSectionKey,
    [selectedSectionKey]
  );
  const {
    applyGenerationChanges: applyFailureChanges,
    resetGenerationFailures,
    summary: failureSummary,
    updateRenderItemError,
  } = useReviewFailureSummary({
    entries: sessionEntries,
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
    currentDemandRef.current = applyReviewNavigationDemand({
      currentDemand: currentDemandRef.current,
      entryKey,
      loader: loaderRef.current,
      seedEntryKeys: seedEntryKeysRef.current,
    });
  }, []);
  const {
    beginReadingNavigating,
    beginReadingRefresh,
    endReadingNavigating,
    endReadingRefresh,
    getReadingMode,
    noteUserScrollReading,
    onNavigationSettled,
    onNavigationStarted,
    syncReadingPinnedPrefix,
  } = useGitReviewReadingCallbacks({
    readingSessionRef,
  });
  const {
    beginGeneration,
    beginNavigation,
    cancelVerification,
    clearForUserIntent,
    getNavigationMemberReason,
    getSelectedEntryKey,
    getSelectedSectionKey,
    hasPendingNavigation,
    navigationError,
    navigationEpoch,
    navigationPending,
    notifyRenderWindowApplied,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    restoreSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  } = useGitReviewNavigation({
    applyNavigationDemand,
    onNavigationSettled,
    onNavigationStarted,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    firstSectionIdByEntryKeyRef,
    itemCacheKeysRef,
    itemIndexByIdRef,
    initialSelectedEntryKey: selectedEntryKey,
    initialSelectedSectionKey: selectedSectionKey,
    loaderRef,
    renderedGenerationRef,
  });
  useGitReviewNavigationError(context, navigationError, retryNavigation);
  const requestRenderWindow = useGitReviewDocumentDemand({
    currentDemandRef,
    entries: sessionEntries,
    entryKeyBySectionIdRef,
    getSelectedEntryKey,
    hasPendingNavigation,
    loaderRef,
    navigationPending,
    renderWindowRef,
    seedEntryKeysRef,
    demandPrefetchEntryKeysRef,
  });
  const activeRef = useRef(renderUpdatesActive);
  activeRef.current = renderUpdatesActive;
  const { handleRenderWindowChange, renderWindowReady } =
    useGitReviewRenderWindowReady({
      activeRef,
      notifyRenderWindowApplied,
      requestRenderWindow,
    });
  const {
    applyItemUpdates,
    clearLatestItemUpdates,
    flushPendingItemUpdates,
    replayFailure,
    recordLatestItemUpdates,
    replayLatestItemUpdates,
    retryLatestItemUpdates,
  } = useGitReviewItemReplay({
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    enabledRef: activeRef,
    latestItemUpdatesRef,
  });
  const generationCallbacksRef = useGitReviewGenerationCallbacks({
    applyFailureChanges,
    applyItemUpdates,
    beginGeneration,
    beginReadingNavigating,
    beginReadingRefresh,
    cancelRetentionSync,
    clearLatestItemUpdates,
    endReadingNavigating,
    endReadingRefresh,
    flushPendingItemUpdates,
    getNavigationMemberReason,
    getReadingMode,
    getSelectedEntryKey,
    getSelectedSectionKey,
    hasPendingNavigation,
    noteUserScrollReading,
    notifyProjectionChanged,
    recordLatestItemUpdates,
    resetGenerationFailures,
    syncReadingPinnedPrefix,
    syncRetentionLimits,
    tryPendingNavigation,
  });
  const { commentsIndexRef, commentsSeqRef, threads } =
    useGitReviewCommentsIntegration({
      collidingFileLabel,
      context,
      controllerRef: documentControllerRef,
      diffBase,
      entries: sessionEntries,
      indexGeneration,
      loaderRef,
      locale: appearance.locale,
      projectedLocaleRef,
      recordLatestItemUpdates,
      scope,
      setProjection,
    });
  useGitReviewDocumentSession({
    collidingFileLabel,
    commentsIndexRef,
    commentsSeqRef,
    committedProjectionGenerationRef,
    context,
    currentDemandRef,
    diffHandleRef,
    diffBase,
    documentControllerRef,
    documentGenerationRef,
    entries: sessionEntries,
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
  });
  useGitReviewProjectionCommit({
    active: renderUpdatesActive,
    committedProjectionGenerationRef,
    diffHandleRef,
    diffBase,
    documentGenerationRef,
    entries: sessionEntries,
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
  });
  const { setDiffHandle } = useGitReviewViewportEffects({
    active: renderUpdatesActive,
    cancelVerification,
    committedProjectionGenerationRef,
    context,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    generationCallbacksRef,
    hasPendingNavigation,
    navigationEpoch,
    navigationPending,
    panelId,
    renderedGenerationRef,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    restoreSelectedNavigation,
    viewState,
    viewStateRef,
  });
  const { isActiveOpenPath, onContextMenuSession, openTreeNode } =
    useGitReviewTreeOpen({
      beginNavigation,
      cancelVerification,
      getSelectedEntryKey: getSelectedTreeEntryKey,
      getSelectedSectionKey: getSelectedTreeSectionKey,
      onRequestOpen: (fileRef) =>
        onRequestTreeOpen(fileRef.entryKey, fileRef.sectionKey, fileRef.group),
      setSelectedTreeTarget,
      treeModel,
    });
  useGitReviewSurfaceNavigationHandoff({
    active,
    applyNavigationDemand,
    beginNavigation,
    diffBase,
    diffHandleRef,
    hasPendingNavigation,
    navigationPending,
    navigationRequest,
    onNavigationMaterialized,
    onSurfaceNavigationSettled,
    projection,
    setSelectedTreeTarget,
  });
  useRetryDocumentsAfterIndexRefresh({
    indexRefreshing,
    loaderRef,
  });
  const retryFailure = useGitReviewRetryFailure({
    beginNavigation,
    diffBase,
    entries,
    entryKeyBySectionIdRef,
    firstSectionIdByEntryKeyRef,
    loaderRef,
    selectedSectionKey,
    sessionEntries,
    setSelectedTreeTarget,
  });
  const comments = useReviewCommentsBinding({
    context,
    entries,
    entryKeyBySectionIdRef,
    indexRefreshing,
    locale: appearance.locale,
    onPendingRevealHandled,
    onRequestTreeOpen,
    pendingReveal,
    projection,
    scope,
    threads,
  });
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <GitReviewSurfaceView
        active={active}
        activeRef={activeRef}
        activeReviewEpoch={comments.activeReviewEpoch}
        activeReviewSlotsByItem={comments.activeReviewSlotsByItem}
        activeSurface={activeSurface}
        appearance={appearance}
        authoritativeEmpty={
          surfaceEntries.length === 0 ||
          !surfaceEntries.some((entry) =>
            reviewEntryHasBodyContent(entry, diffBase)
          )
        }
        clearForUserIntent={clearForUserIntent}
        collidingFileLabel={collidingFileLabel}
        context={context}
        diffHandleRef={diffHandleRef}
        driftCommentLabels={comments.driftCommentLabels}
        entries={entries}
        failureSummary={failureSummary}
        handleMutationCommitted={handleMutationCommitted}
        handleRenderWindowChange={handleRenderWindowChange}
        hasPendingNavigation={hasPendingNavigation}
        indexRefreshFailure={indexRefreshFailure}
        inlineReviewHandlers={comments.inlineReviewHandlers}
        inlineReviewLabels={comments.inlineReviewLabels}
        inlineReviewThreadById={comments.inlineReviewThreadById}
        isActiveOpenPath={isActiveOpenPath}
        mutationAuthorityBlocked={mutationAuthorityBlocked}
        navigationPending={navigationPending}
        noteUserScrollReading={noteUserScrollReading}
        {...(onActiveChromeChange === undefined
          ? {}
          : { onActiveChromeChange })}
        onAcquireMutationAuthority={onAcquireMutationAuthority}
        onContextMenuSession={onContextMenuSession}
        onDriftCommentActivate={comments.openDriftThread}
        onGutterReviewActivate={comments.handleGutterReviewActivate}
        onRetryIndex={onRetryIndex}
        openTreeNode={openTreeNode}
        panelId={panelId}
        projection={projection}
        renderFeedback={renderFeedback}
        renderWindowReady={renderWindowReady}
        replayFailure={replayFailure}
        retryFailure={retryFailure}
        retryLatestItemUpdates={retryLatestItemUpdates}
        reviewCommentsById={comments.reviewCommentsById}
        scope={scope}
        setDiffHandle={setDiffHandle}
        setSelectedTreeTarget={setSelectedTreeTarget}
        setSidebarCollapsed={setSidebarCollapsed}
        sidebarCollapsed={sidebarCollapsed}
        targetSelectionPending={targetSelectionPending}
        treeModel={treeModel}
        updateRenderFeedback={updateRenderFeedback}
        updateRenderItemError={updateRenderItemError}
        viewOptions={viewOptions}
        viewState={viewState}
        warnings={warnings}
      />
      <ReviewCommentsChrome
        collidingFileLabel={collidingFileLabel}
        comments={comments}
        context={context}
        diffBase={diffBase}
        diffHandleRef={diffHandleRef}
        entries={entries}
        onRequestTreeOpen={onRequestTreeOpen}
        threads={threads}
        worktreeKey={scope.gitRootPath}
      />
    </div>
  );
}

export const ReviewSurface = memo(ReviewSurfaceComponent);
