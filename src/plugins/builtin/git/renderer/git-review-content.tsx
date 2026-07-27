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
import { pluginText } from "./git-plugin-text.ts";
import type { ReviewRenderFeedback } from "./git-review-code-view.tsx";
import {
  prioritizeReviewNavigationDemand,
  type ReviewDocumentDemand,
} from "./git-review-document-demand.ts";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  type PendingReviewAnchor,
} from "./git-review-document-projection.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
  useReviewAppearance,
  useReviewSelection,
  useReviewViewOptions,
} from "./git-review-document-ui-state.ts";
import { GitReviewDocumentView } from "./git-review-document-view.tsx";
import { useReviewFailureSummary } from "./git-review-failure-state.ts";
import type { ReviewReadingSide } from "./git-review-reading-anchor.ts";
import { createGitReviewReadingSession } from "./git-review-reading-session.ts";
import { GitReviewToolbar } from "./git-review-toolbar.tsx";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";
import { useGitReviewDocumentDemand } from "./use-git-review-document-demand.ts";
import { useGitReviewDocumentSession } from "./use-git-review-document-session.ts";
import { useGitReviewGenerationCallbacks } from "./use-git-review-generation-callbacks.ts";
import { useGitReviewItemReplay } from "./use-git-review-item-replay.ts";
import { useGitReviewLocaleProjection } from "./use-git-review-locale-projection.ts";
import { useGitReviewNavigation } from "./use-git-review-navigation.ts";
import { useGitReviewProjectionCommit } from "./use-git-review-projection-commit.ts";
import { useGitReviewReadingCallbacks } from "./use-git-review-reading-callbacks.ts";
import { useGitReviewRetentionSync } from "./use-git-review-retention-sync.ts";
import { useGitReviewTreeOpen } from "./use-git-review-tree-open.ts";
import { useGitReviewViewportEffects } from "./use-git-review-viewport-effects.ts";

function ReviewDocumentsComponent({
  context,
  entries,
  headerLeading,
  indexGeneration,
  indexRefreshFailure,
  indexRefreshing = false,
  onRetryIndex,
  panelId,
  scope,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sidebarHeader,
  treeModel,
  warnings,
}: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly headerLeading?: React.ReactNode;
  readonly indexGeneration: number;
  readonly indexRefreshFailure: GitReviewFailure | null;
  readonly indexRefreshing?: boolean;
  readonly onRetryIndex: () => void;
  readonly panelId: string;
  readonly scope: GitReviewScope;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sidebarHeader?: React.ReactNode;
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
  const sideBySectionIdRef = useRef(new Map<string, ReviewReadingSide>());
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
  const readingSessionRef = useRef(createGitReviewReadingSession());
  const scopeKeyRef = useRef<string | null>(null);
  const viewStateRef = useRef(EMPTY_DOCUMENT_VIEW_STATE);
  const [viewState, setViewState] = useState(EMPTY_DOCUMENT_VIEW_STATE);
  const [projection, setProjection] = useState(EMPTY_REVIEW_PROJECTION);
  const [projectionGeneration, setProjectionGeneration] = useState(0);

  const {
    selectedEntryKey,
    selectedSectionKey,
    selectedTreeEntry,
    setSelectedTreeTarget,
  } = useReviewSelection(scope, treeModel);
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
  // 渲染层崩溃由 ReviewCodeView 自身以 Empty 呈现,这里无需再镜像状态。
  const updateRenderFeedback = useCallback(
    (_feedback: ReviewRenderFeedback | null) => undefined,
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
    itemIdsRef,
    pendingAnchorRef,
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
    notifyProjectionChanged,
    resumeSelectedNavigation,
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
    pendingAnchorRef,
    renderedGenerationRef,
  });
  // 真正无法定位时 toast + Retry；已可见内容的超时在 hook 内静默。
  useEffect(() => {
    if (!navigationError) {
      return;
    }
    context.notifications.error(
      pluginText(
        context,
        "reviewNavigationFailed",
        "Failed to navigate to file"
      ),
      {
        action: {
          label: pluginText(context, "reviewRetry", "Retry"),
          onClick: () => {
            retryNavigation();
          },
        },
      }
    );
  }, [context, navigationError, retryNavigation]);
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
    entries,
    loaderRef,
    locale: appearance.locale,
    projectedLocaleRef,
    recordLatestItemUpdates,
    setProjection,
  });

  const { setDiffHandle } = useGitReviewViewportEffects({
    cancelVerification,
    committedProjectionGenerationRef,
    context,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    generationCallbacksRef,
    hasPendingNavigation,
    itemIdsRef,
    navigationEpoch,
    navigationPending,
    panelId,
    pendingAnchorRef,
    renderedGenerationRef,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    sideBySectionIdRef,
    viewState,
    viewStateRef,
  });

  const { isActiveOpenPath, onContextMenuSession, openTreeNode } =
    useGitReviewTreeOpen({
      beginNavigation,
      cancelVerification,
      diffHandleRef,
      getSelectedEntryKey,
      getSelectedSectionKey,
      setSelectedTreeTarget,
      treeModel,
    });
  const retryFailure = useCallback(
    (entryKey: string) => {
      loaderRef.current?.retry(entryKey);
      const sectionKey =
        selectedSectionKey &&
        entryKeyBySectionIdRef.current.get(selectedSectionKey) === entryKey
          ? selectedSectionKey
          : firstSectionIdByEntryKeyRef.current.get(entryKey);
      if (!sectionKey) {
        return;
      }
      setSelectedTreeTarget({ entryKey, sectionKey });
      // scroll 由 navigationPending layout 触发（子 apply 之后）
      beginNavigation({ entryKey, sectionKey });
    },
    [beginNavigation, selectedSectionKey, setSelectedTreeTarget]
  );
  const handleRenderItemError = useCallback(
    (id: string, error: Error | null) => {
      // 终态：仅 settled 后的 parse 错误进失败面，避免 materialize/stage 闪错。
      updateRenderItemError(viewState.generation, id, error, viewState.settled);
    },
    [updateRenderItemError, viewState.generation, viewState.settled]
  );
  const { options: viewOptions, setOptions: setViewOptions } =
    useReviewViewOptions();
  const [allCollapsed, setAllCollapsed] = useState(false);
  const onToggleCollapseAll = useCallback(() => {
    setAllCollapsed((current) => {
      const next = !current;
      diffHandleRef.current?.setAllCollapsed(next);
      return next;
    });
  }, []);
  const toolbar = (
    <GitReviewToolbar
      allCollapsed={allCollapsed}
      context={context}
      onRefresh={onRetryIndex}
      onToggleCollapseAll={onToggleCollapseAll}
      refreshing={indexRefreshing}
      setViewOptions={setViewOptions}
      viewOptions={viewOptions}
    />
  );
  return (
    <GitReviewDocumentView
      appearance={appearance}
      context={context}
      contextId={scope.contextId}
      diffRef={setDiffHandle}
      {...(scope.target.kind === "uncommitted" ? { entries } : {})}
      failureSummary={failureSummary}
      gitRootPath={scope.gitRootPath}
      {...(headerLeading === undefined ? {} : { headerLeading })}
      getSuppressMembershipScrollRestore={hasPendingNavigation}
      headerTrailing={toolbar}
      indexFailure={indexRefreshFailure}
      isActiveOpenPath={isActiveOpenPath}
      onContextMenuSession={onContextMenuSession}
      onFeedbackChange={updateRenderFeedback}
      onItemError={handleRenderItemError}
      onOpenPath={openTreeNode}
      onRenderWindowChange={requestRenderWindow}
      onRetryFailure={retryFailure}
      onRetryIndex={onRetryIndex}
      onScroll={() => {
        // 用户滚动意图（已在 DiffView 手势级合并）；只做轻量工作
        noteUserScrollReading();
        clearForUserIntent();
        // setSelectedTreeTarget(null) 内部对 entry/section 有 previous===next 短路
        setSelectedTreeTarget(null);
        if (pendingAnchorRef.current?.restored) {
          pendingAnchorRef.current = null;
        }
      }}
      presentation={{
        diffStyle: viewOptions.diffStyle,
        wrapLines: viewOptions.wrapLines,
      }}
      projection={projection}
      // 渲染层崩溃(renderFeedback)由 ReviewCodeView 自身以 Empty 呈现;
      // 这里只把「正文仍可见但最新更新被拒」的 replay 失败交给横条。
      renderFeedback={
        replayFailure
          ? { error: replayFailure, retry: retryLatestItemUpdates }
          : null
      }
      selectedTreePath={selectedTreeEntry?.path ?? null}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      suppressMembershipScrollRestore={navigationPending}
      {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
      {...(sidebarHeader === undefined ? {} : { sidebarHeader })}
      sourcePanelId={panelId}
      treeModel={treeModel}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

export const ReviewDocuments = memo(ReviewDocumentsComponent);
