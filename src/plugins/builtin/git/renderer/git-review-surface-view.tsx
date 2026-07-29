import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitChangeSummary } from "@shared/contracts/git.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewMutationOk,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import { useCallback, useRef, useState } from "react";
import { GitChangeSummaryInline } from "./git-change-summary-display.tsx";
import { pluginText } from "./git-plugin-text.ts";
import type { ReviewRenderFeedback } from "./git-review-code-view.tsx";
import type {
  ReviewDocumentProjection,
  ReviewDocumentViewState,
} from "./git-review-document-projection.ts";
import {
  type useReviewAppearance,
  useReviewViewOptions,
} from "./git-review-document-ui-state.ts";
import { GitReviewDocumentView } from "./git-review-document-view.tsx";
import type { useReviewFailureSummary } from "./git-review-failure-state.ts";
import type {
  GitReviewMutationLease,
  GitReviewReadingSurface,
  UncommittedGitReviewSurface,
} from "./git-review-reading-surface.ts";
import { GitReviewSurfaceSwitcher } from "./git-review-surface-switcher.tsx";
import { GitReviewToolbar } from "./git-review-toolbar.tsx";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

interface GitReviewSurfaceViewProps {
  readonly active: boolean;
  readonly activeRef: React.RefObject<boolean>;
  readonly activeSurface: GitReviewReadingSurface;
  readonly appearance: ReturnType<typeof useReviewAppearance>;
  readonly authoritativeEmpty: boolean;
  readonly clearForUserIntent: () => void;
  readonly context: RendererPluginContext;
  readonly diffHandleRef: React.RefObject<PierDiffViewHandle | null>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly failureSummary: ReturnType<
    typeof useReviewFailureSummary
  >["summary"];
  readonly handleMutationCommitted: (
    result: GitReviewMutationOk | null
  ) => Promise<void>;
  readonly handleRenderWindowChange: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onRenderWindowChange"];
  readonly hasPendingNavigation: () => boolean;
  readonly headerLeading?: React.ReactNode;
  readonly headerSummary?: GitChangeSummary;
  readonly indexRefreshFailure: GitReviewFailure | null;
  readonly indexRefreshing: boolean;
  readonly isActiveOpenPath: React.ComponentProps<
    typeof GitReviewDocumentView
  >["isActiveOpenPath"];
  readonly mutationAuthorityBlocked: boolean;
  readonly navigationPending: boolean;
  readonly noteUserScrollReading: () => void;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onContextMenuSession: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onContextMenuSession"];
  readonly onRetryIndex: () => void;
  readonly onSelectSurface: (surface: GitReviewReadingSurface) => void;
  readonly openTreeNode: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onOpenPath"];
  readonly panelId: string;
  readonly projection: ReviewDocumentProjection;
  readonly renderFeedback: ReviewRenderFeedback | null;
  readonly renderWindowReady: boolean;
  readonly replayFailure: Error | null;
  readonly retryFailure: (entryKey: string) => void;
  readonly retryLatestItemUpdates: () => void;
  readonly scope: GitReviewScope;
  readonly setDiffHandle: React.ComponentProps<
    typeof GitReviewDocumentView
  >["diffRef"];
  readonly setSelectedTreeTarget: (
    target: { readonly entryKey: string; readonly sectionKey: string } | null
  ) => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sidebarHeader?: React.ReactNode;
  readonly targetSelectionPending: boolean;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly updateRenderFeedback: (
    feedback: ReviewRenderFeedback | null
  ) => void;
  readonly updateRenderItemError: (
    generation: number,
    id: string,
    error: Error | null,
    settled: boolean
  ) => void;
  readonly viewState: ReviewDocumentViewState;
  readonly warnings: GitReviewIndexOk["warnings"];
}

export function GitReviewSurfaceView({
  active,
  activeRef,
  activeSurface,
  appearance,
  authoritativeEmpty,
  clearForUserIntent,
  context,
  diffHandleRef,
  entries,
  failureSummary,
  handleMutationCommitted,
  handleRenderWindowChange,
  hasPendingNavigation,
  headerLeading,
  headerSummary,
  indexRefreshFailure,
  indexRefreshing,
  isActiveOpenPath,
  navigationPending,
  mutationAuthorityBlocked,
  noteUserScrollReading,
  onContextMenuSession,
  onAcquireMutationAuthority,
  onRetryIndex,
  onSelectSurface,
  openTreeNode,
  panelId,
  projection,
  renderFeedback,
  renderWindowReady,
  replayFailure,
  retryFailure,
  retryLatestItemUpdates,
  scope,
  setDiffHandle,
  setSelectedTreeTarget,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sidebarHeader,
  targetSelectionPending,
  treeModel,
  updateRenderFeedback,
  updateRenderItemError,
  viewState,
  warnings,
}: GitReviewSurfaceViewProps): React.JSX.Element {
  const renderItemErrorRef = useRef({
    generation: viewState.generation,
    settled: viewState.settled,
    update: updateRenderItemError,
  });
  renderItemErrorRef.current = {
    generation: viewState.generation,
    settled: viewState.settled,
    update: updateRenderItemError,
  };
  const handleRenderItemError = useCallback(
    (id: string, error: Error | null) => {
      const current = renderItemErrorRef.current;
      current.update(current.generation, id, error, current.settled);
    },
    []
  );
  const reviewScrollCallbacksRef = useRef({
    clearForUserIntent,
    noteUserScrollReading,
    setSelectedTreeTarget,
  });
  reviewScrollCallbacksRef.current = {
    clearForUserIntent,
    noteUserScrollReading,
    setSelectedTreeTarget,
  };
  const handleReviewScroll = useCallback(() => {
    if (!activeRef.current) {
      return;
    }
    const callbacks = reviewScrollCallbacksRef.current;
    // packages/ui 只在 wheel/touch/pointer/导航键意图时调用此回调；
    // Pierre 的程序化 onScroll 不会进入这里。用户输入始终接管导航事务。
    callbacks.noteUserScrollReading();
    callbacks.clearForUserIntent();
    callbacks.setSelectedTreeTarget(null);
  }, [activeRef]);
  const { options: viewOptions, setOptions: setViewOptions } =
    useReviewViewOptions();
  const [allCollapsed, setAllCollapsed] = useState(false);
  const onToggleCollapseAll = useCallback(() => {
    setAllCollapsed((current) => {
      const next = !current;
      diffHandleRef.current?.setAllCollapsed(next);
      return next;
    });
  }, [diffHandleRef]);
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
  const surfaceHeader =
    scope.target.kind === "uncommitted" ? (
      <div className="flex min-w-0 items-center gap-2">
        {headerLeading}
        <GitReviewSurfaceSwitcher
          context={context}
          groups={treeModel.visibleGroups}
          labels={treeModel.groupLabels}
          onSelect={onSelectSurface}
          value={requireUncommittedSurface(activeSurface)}
        />
      </div>
    ) : (
      headerLeading
    );
  const emptyText = gitReviewSurfaceEmptyText(context, activeSurface);
  return (
    <GitReviewDocumentView
      appearance={appearance}
      authoritativeEmpty={authoritativeEmpty}
      context={context}
      contextId={scope.contextId}
      diffRef={setDiffHandle}
      emptyDescription={emptyText.description}
      emptySurface={activeSurface}
      emptyTitle={emptyText.title}
      {...(scope.target.kind === "uncommitted" ? { entries } : {})}
      failureSummary={failureSummary}
      feedbackEnabled={active}
      gitRootPath={scope.gitRootPath}
      {...(headerSummary === undefined
        ? {}
        : {
            headerCenter: (
              <GitChangeSummaryInline
                className="text-xs"
                context={context}
                filesWithUnit
                summary={headerSummary}
                testId="git-review-change-summary"
              />
            ),
          })}
      {...(surfaceHeader === undefined ? {} : { headerLeading: surfaceHeader })}
      getSuppressMembershipScrollRestore={hasPendingNavigation}
      headerTrailing={toolbar}
      indexFailure={indexRefreshFailure}
      {...(isActiveOpenPath === undefined ? {} : { isActiveOpenPath })}
      {...(onContextMenuSession === undefined ? {} : { onContextMenuSession })}
      mutationAuthorityBlocked={mutationAuthorityBlocked}
      onAcquireMutationAuthority={onAcquireMutationAuthority}
      onFeedbackChange={updateRenderFeedback}
      onItemError={handleRenderItemError}
      onMutationCommitted={handleMutationCommitted}
      onOpenPath={openTreeNode}
      onRenderWindowChange={handleRenderWindowChange}
      onRetryFailure={retryFailure}
      onRetryIndex={onRetryIndex}
      onScroll={handleReviewScroll}
      presentation={{
        diffStyle: viewOptions.diffStyle,
        wrapLines: viewOptions.wrapLines,
      }}
      projection={projection}
      renderFeedback={
        renderFeedback ??
        (replayFailure
          ? { error: replayFailure, retry: retryLatestItemUpdates }
          : null)
      }
      renderWindowReady={renderWindowReady}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      suppressMembershipScrollRestore={navigationPending}
      {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
      {...(sidebarHeader === undefined ? {} : { sidebarHeader })}
      sourcePanelId={panelId}
      targetSelectionPending={targetSelectionPending}
      treeModel={treeModel}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

function gitReviewSurfaceEmptyText(
  context: RendererPluginContext,
  surface: GitReviewReadingSurface
): { readonly description: string; readonly title: string } {
  switch (surface) {
    case "conflict":
      return {
        description: pluginText(
          context,
          "reviewSurfaceConflictEmptyDescription",
          "Resolve a conflict to continue reviewing other changes."
        ),
        title: pluginText(
          context,
          "reviewSurfaceConflictEmptyTitle",
          "No merge changes"
        ),
      };
    case "index":
      return {
        description: pluginText(
          context,
          "reviewSurfaceIndexEmptyDescription",
          "Switch to Staged Changes to continue reviewing."
        ),
        title: pluginText(
          context,
          "reviewSurfaceIndexEmptyTitle",
          "No unstaged changes"
        ),
      };
    case "staged":
      return {
        description: pluginText(
          context,
          "reviewSurfaceStagedEmptyDescription",
          "Stage changes to review them here."
        ),
        title: pluginText(
          context,
          "reviewSurfaceStagedEmptyTitle",
          "No staged changes"
        ),
      };
    case "committed":
      return {
        description: pluginText(
          context,
          "reviewEmptyDescriptionCommit",
          "The selected commit has no file changes."
        ),
        title: pluginText(context, "reviewEmptyTitle", "No changes"),
      };
    default: {
      const exhaustive: never = surface;
      return exhaustive;
    }
  }
}

function requireUncommittedSurface(
  surface: GitReviewReadingSurface
): UncommittedGitReviewSurface {
  if (surface === "committed") {
    throw new Error("未提交变更视图不能使用提交阅读面");
  }
  return surface;
}
