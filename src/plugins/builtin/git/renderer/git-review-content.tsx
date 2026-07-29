import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  prioritizeReviewNavigationDemand,
  type ReviewDocumentDemand,
} from "./git-review-document-demand.ts";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import { EMPTY_DOCUMENT_VIEW_STATE } from "./git-review-document-projection.ts";
import { reviewTreeSectionKeyForSurface } from "./git-review-document-projection-index.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
  useReviewAppearance,
  useReviewSelection,
} from "./git-review-document-ui-state.ts";
import { useReviewFailureSummary } from "./git-review-failure-state.ts";
import { createGitReviewReadingSession } from "./git-review-reading-session.ts";
import { reviewGroupsForSurface } from "./git-review-surface-group.ts";
import type { ReviewSurfaceProps } from "./git-review-surface-types.ts";
import { GitReviewSurfaceView } from "./git-review-surface-view.tsx";
import { useGitReviewDocumentDemand } from "./use-git-review-document-demand.ts";
import { useGitReviewDocumentSession } from "./use-git-review-document-session.ts";
import { useGitReviewGenerationCallbacks } from "./use-git-review-generation-callbacks.ts";
import { useGitReviewItemReplay } from "./use-git-review-item-replay.ts";
import { useGitReviewLocaleProjection } from "./use-git-review-locale-projection.ts";
import { useGitReviewMutationCommit } from "./use-git-review-mutation-commit.ts";
import { useGitReviewNavigation } from "./use-git-review-navigation.ts";
import { useGitReviewNavigationError } from "./use-git-review-navigation-error.ts";
import { useGitReviewProjectionCommit } from "./use-git-review-projection-commit.ts";
import { useGitReviewReadingCallbacks } from "./use-git-review-reading-callbacks.ts";
import { useGitReviewRetentionSync } from "./use-git-review-retention-sync.ts";
import { useGitReviewSurfaceNavigationHandoff } from "./use-git-review-surface-navigation-handoff.ts";
import { useGitReviewTreeOpen } from "./use-git-review-tree-open.ts";
import { useGitReviewViewportEffects } from "./use-git-review-viewport-effects.ts";

function ReviewSurfaceComponent({
  active,
  activeSurface,
  context,
  diffBase,
  entries,
  headerLeading,
  indexGeneration,
  indexRefreshFailure,
  indexRefreshing = false,
  mutationAuthorityBlocked,
  navigationRequest,
  onAcquireMutationAuthority,
  onMutationCommitted,
  onMutationTransition,
  onNavigationMaterialized,
  onSurfaceNavigationSettled,
  onRequestTreeOpen,
  onRetryIndex,
  onSelectSurface,
  panelId,
  scope,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sidebarHeader,
  treeModel,
  warnings,
}: ReviewSurfaceProps): React.JSX.Element {
  const surfaceEntries = useMemo(
    () =>
      entries.filter((entry) =>
        entry.renderSlots.some((slot) =>
          reviewGroupsForSurface(diffBase).includes(slot.group)
        )
      ),
    [diffBase, entries]
  );
  const freezeSourceMembership = active && mutationAuthorityBlocked;
  const preparingNavigationTarget =
    !active &&
    navigationRequest !== null &&
    navigationRequest.surface === diffBase;
  const retainedSurfaceEntriesRef = useRef(surfaceEntries);
  const refreshSurfaceMembership =
    (active && !freezeSourceMembership) || preparingNavigationTarget;
  if (refreshSurfaceMembership) {
    retainedSurfaceEntriesRef.current = surfaceEntries;
  }
  const sessionEntries = refreshSurfaceMembership
    ? surfaceEntries
    : retainedSurfaceEntriesRef.current;
  const renderUpdatesActive = active && !freezeSourceMembership;
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
  // 渲染层崩溃由 ReviewCodeView 自身以 Empty 呈现,这里无需再镜像状态。
  const updateRenderFeedback = useCallback(() => undefined, []);
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
  const requestRenderWindowRef = useRef(requestRenderWindow);
  activeRef.current = renderUpdatesActive;
  requestRenderWindowRef.current = requestRenderWindow;
  const handleRenderWindowChange = useCallback(
    (window: PierDiffViewRenderWindow) => {
      if (activeRef.current) {
        requestRenderWindowRef.current(window);
        notifyRenderWindowApplied(window);
      }
    },
    [notifyRenderWindowApplied]
  );
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
      authoritativeEmpty={surfaceEntries.length === 0}
      clearForUserIntent={clearForUserIntent}
      context={context}
      diffHandleRef={diffHandleRef}
      entries={entries}
      failureSummary={failureSummary}
      handleMutationCommitted={handleMutationCommitted}
      handleRenderWindowChange={handleRenderWindowChange}
      hasPendingNavigation={hasPendingNavigation}
      {...(headerLeading === undefined ? {} : { headerLeading })}
      indexRefreshFailure={indexRefreshFailure}
      indexRefreshing={indexRefreshing}
      isActiveOpenPath={isActiveOpenPath}
      mutationAuthorityBlocked={mutationAuthorityBlocked}
      navigationPending={navigationPending}
      noteUserScrollReading={noteUserScrollReading}
      onAcquireMutationAuthority={onAcquireMutationAuthority}
      onContextMenuSession={onContextMenuSession}
      onRetryIndex={onRetryIndex}
      onSelectSurface={onSelectSurface}
      openTreeNode={openTreeNode}
      panelId={panelId}
      projection={projection}
      replayFailure={replayFailure}
      retryFailure={retryFailure}
      retryLatestItemUpdates={retryLatestItemUpdates}
      scope={scope}
      setDiffHandle={setDiffHandle}
      setSelectedTreeTarget={setSelectedTreeTarget}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
      {...(sidebarHeader === undefined ? {} : { sidebarHeader })}
      treeModel={treeModel}
      updateRenderFeedback={updateRenderFeedback}
      updateRenderItemError={updateRenderItemError}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

export const ReviewSurface = memo(ReviewSurfaceComponent);
