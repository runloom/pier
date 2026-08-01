import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view/index.tsx";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useGitReviewDocumentDemand } from "../hooks/use-document-demand.ts";
import { useGitReviewDocumentSession } from "../hooks/use-document-session.ts";
import { useGitReviewGenerationCallbacks } from "../hooks/use-generation-callbacks.ts";
import { useGitReviewItemReplay } from "../hooks/use-item-replay.ts";
import { useGitReviewLocaleProjection } from "../hooks/use-locale-projection.ts";
import { useGitReviewMutationCommit } from "../hooks/use-mutation-commit.ts";
import { useGitReviewNavigation } from "../hooks/use-navigation.ts";
import { useGitReviewNavigationError } from "../hooks/use-navigation-error.ts";
import { useGitReviewProjectionCommit } from "../hooks/use-projection-commit.ts";
import { useGitReviewReadingCallbacks } from "../hooks/use-reading-callbacks.ts";
import { useGitReviewRenderWindowReady } from "../hooks/use-render-window-ready.ts";
import { useGitReviewRetentionSync } from "../hooks/use-retention-sync.ts";
import { useGitReviewSurfaceNavigationHandoff } from "../hooks/use-surface-navigation-handoff.ts";
import { useGitReviewSurfaceSessionEntries } from "../hooks/use-surface-session-entries.ts";
import { useGitReviewTreeOpen } from "../hooks/use-tree-open.ts";
import { useGitReviewViewportEffects } from "../hooks/use-viewport-effects.ts";
import type { ReviewRenderFeedback } from "./code-view.tsx";
import { reviewEntryHasBodyContent } from "./document/body-class.ts";
import {
  prioritizeReviewNavigationDemand,
  type ReviewDocumentDemand,
} from "./document/demand.ts";
import type { GitReviewDocumentGeneration } from "./document/generation.ts";
import type { GitReviewDocumentLoader } from "./document/loader.ts";
import { EMPTY_DOCUMENT_VIEW_STATE } from "./document/projection.ts";
import { reviewTreeSectionKeyForSurface } from "./document/projection-index.ts";
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
  mutationAuthorityBlocked,
  navigationRequest,
  onAcquireMutationAuthority,
  onMutationCommitted,
  onMutationTransition,
  onNavigationMaterialized,
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
  // 首屏估算正文保持隐藏时，仍需把渲染错误同步到外层，确保错误主体不会被骨架遮住。
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
    // full-alignment：boost selected，保留 window/seed（禁止 pin-only exclusive replace）
    const current = currentDemandRef.current;
    const hasWindow =
      current.visibleEntryKeys.length > 0 ||
      current.bufferedEntryKeys.length > 0;
    const base = hasWindow
      ? current
      : {
          bufferedEntryKeys: [] as const,
          visibleEntryKeys:
            seedEntryKeysRef.current.length > 0
              ? seedEntryKeysRef.current
              : ([entryKey] as const),
        };
    const demand = prioritizeReviewNavigationDemand(base, entryKey, true);
    currentDemandRef.current = demand;
    // 先 demand（含 selected boost）再 protect，避免无 window 时 protect 误开读
    loaderRef.current?.setWindowDemand(demand);
    loaderRef.current?.setProtectedEntryKey(entryKey);
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
  useGitReviewDocumentSession({
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
  useGitReviewLocaleProjection({
    context,
    controllerRef: documentControllerRef,
    diffBase,
    entries: sessionEntries,
    indexGeneration,
    loaderRef,
    locale: appearance.locale,
    projectedLocaleRef,
    recordLatestItemUpdates,
    setProjection,
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
      onRequestOpen: (fileRef) => {
        onRequestTreeOpen(fileRef.entryKey, fileRef.sectionKey, fileRef.group);
      },
      setSelectedTreeTarget,
      treeModel,
    });
  useGitReviewSurfaceNavigationHandoff({
    active,
    applyNavigationDemand,
    beginNavigation,
    diffBase,
    hasPendingNavigation,
    navigationPending,
    navigationRequest,
    onNavigationMaterialized,
    onSurfaceNavigationSettled,
    projection,
    setSelectedTreeTarget,
  });
  const retryFailure = useCallback(
    (entryKey: string) => {
      loaderRef.current?.retry(entryKey);
      const retryEntry =
        entries.find((entry) => entry.entryKey === entryKey) ??
        sessionEntries.find((entry) => entry.entryKey === entryKey);
      let treeSectionKey: string | null = null;
      if (
        selectedSectionKey &&
        entryKeyBySectionIdRef.current.get(selectedSectionKey) === entryKey
      ) {
        treeSectionKey = selectedSectionKey;
      } else if (retryEntry) {
        treeSectionKey = reviewTreeSectionKeyForSurface(retryEntry, diffBase);
      }
      const itemId = firstSectionIdByEntryKeyRef.current.get(entryKey);
      if (!(treeSectionKey && itemId)) {
        return;
      }
      setSelectedTreeTarget({ entryKey, sectionKey: treeSectionKey });
      // scroll 由 navigationPending layout 触发（子 apply 之后）
      beginNavigation({ entryKey, sectionKey: itemId });
    },
    [
      beginNavigation,
      diffBase,
      entries,
      selectedSectionKey,
      setSelectedTreeTarget,
      sessionEntries,
    ]
  );
  return (
    <GitReviewSurfaceView
      active={active}
      activeRef={activeRef}
      activeSurface={activeSurface}
      appearance={appearance}
      authoritativeEmpty={
        surfaceEntries.length === 0 ||
        !surfaceEntries.some((entry) =>
          reviewEntryHasBodyContent(entry, diffBase)
        )
      }
      clearForUserIntent={clearForUserIntent}
      context={context}
      diffHandleRef={diffHandleRef}
      entries={entries}
      failureSummary={failureSummary}
      handleMutationCommitted={handleMutationCommitted}
      handleRenderWindowChange={handleRenderWindowChange}
      hasPendingNavigation={hasPendingNavigation}
      indexRefreshFailure={indexRefreshFailure}
      isActiveOpenPath={isActiveOpenPath}
      mutationAuthorityBlocked={mutationAuthorityBlocked}
      navigationPending={navigationPending}
      noteUserScrollReading={noteUserScrollReading}
      {...(onActiveChromeChange === undefined ? {} : { onActiveChromeChange })}
      onAcquireMutationAuthority={onAcquireMutationAuthority}
      onContextMenuSession={onContextMenuSession}
      onRetryIndex={onRetryIndex}
      openTreeNode={openTreeNode}
      panelId={panelId}
      projection={projection}
      renderFeedback={renderFeedback}
      renderWindowReady={renderWindowReady}
      replayFailure={replayFailure}
      retryFailure={retryFailure}
      retryLatestItemUpdates={retryLatestItemUpdates}
      scope={scope}
      setDiffHandle={setDiffHandle}
      setSelectedTreeTarget={setSelectedTreeTarget}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      targetSelectionPending={targetSelectionPending}
      treeModel={treeModel}
      updateRenderFeedback={updateRenderFeedback}
      updateRenderItemError={updateRenderItemError}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

export const ReviewSurface = memo(ReviewSurfaceComponent);
