import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewMutationOk,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { pluginText } from "../plugin-text.ts";
import type { ReviewRenderFeedback } from "./code-view.tsx";
import { reviewEntryHasBodyContent } from "./document/body-class.ts";
import type {
  ReviewDocumentProjection,
  ReviewDocumentViewState,
} from "./document/projection.ts";
import {
  type useReviewAppearance,
  useReviewViewOptions,
} from "./document/ui-state.ts";
import { GitReviewDocumentView } from "./document/view.tsx";
import type { useReviewFailureSummary } from "./failure-state.ts";
import type {
  GitReviewMutationLease,
  GitReviewReadingSurface,
} from "./reading-surface.ts";
import { reviewGroupsForSurface } from "./surface-group.ts";
import type { ReviewActiveChrome } from "./surface-types.ts";
import type { gitReviewTreeModel } from "./tree.tsx";

interface GitReviewSurfaceViewProps {
  readonly active: boolean;
  readonly activeRef: React.RefObject<boolean>;
  readonly activeReviewEpoch?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["activeReviewEpoch"];
  readonly activeReviewSlotsByItem?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["activeReviewSlotsByItem"];
  readonly activeSurface: GitReviewReadingSurface;
  readonly appearance: ReturnType<typeof useReviewAppearance>;
  readonly authoritativeEmpty: boolean;
  readonly clearForUserIntent: () => void;
  readonly collidingFileLabel?: (name: string) => string;
  readonly context: RendererPluginContext;
  readonly diffHandleRef: React.RefObject<PierDiffViewHandle | null>;
  readonly driftCommentLabels?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["driftCommentLabels"];
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
  readonly indexRefreshFailure: GitReviewFailure | null;
  readonly inlineReviewHandlers?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["inlineReviewHandlers"];
  readonly inlineReviewLabels?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["inlineReviewLabels"];
  readonly inlineReviewThreadById?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["inlineReviewThreadById"];
  readonly isActiveOpenPath: React.ComponentProps<
    typeof GitReviewDocumentView
  >["isActiveOpenPath"];
  readonly mutationAuthorityBlocked: boolean;
  readonly navigationPending: boolean;
  readonly noteUserScrollReading: () => void;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onActiveChromeChange?: (chrome: ReviewActiveChrome | null) => void;
  readonly onContextMenuSession: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onContextMenuSession"];
  readonly onDriftCommentActivate?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onDriftCommentActivate"];
  readonly onGutterReviewActivate?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["onGutterReviewActivate"];
  readonly onRetryIndex: () => void;
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
  readonly reviewCommentsById?: React.ComponentProps<
    typeof GitReviewDocumentView
  >["reviewCommentsById"];
  readonly scope: GitReviewScope;
  readonly setDiffHandle: React.ComponentProps<
    typeof GitReviewDocumentView
  >["diffRef"];
  readonly setSelectedTreeTarget: (
    target: { readonly entryKey: string; readonly sectionKey: string } | null
  ) => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
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
  collidingFileLabel,
  context,
  diffHandleRef,
  entries,
  failureSummary,
  driftCommentLabels,
  activeReviewEpoch,
  activeReviewSlotsByItem,
  inlineReviewHandlers,
  inlineReviewLabels,
  inlineReviewThreadById,
  handleMutationCommitted,
  handleRenderWindowChange,
  hasPendingNavigation,
  indexRefreshFailure,
  isActiveOpenPath,
  navigationPending,
  mutationAuthorityBlocked,
  noteUserScrollReading,
  onActiveChromeChange,
  onContextMenuSession,
  onGutterReviewActivate,
  onDriftCommentActivate,
  onAcquireMutationAuthority,
  onRetryIndex,
  openTreeNode,
  panelId,
  projection,
  reviewCommentsById,
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
  // 视图偏好全局一份；工具条写在共享 header，此处只读给 CodeView presentation
  const { options: viewOptions } = useReviewViewOptions();
  const [allCollapsed, setAllCollapsed] = useState(false);
  const onToggleCollapseAll = useCallback(() => {
    setAllCollapsed((current) => {
      const next = !current;
      diffHandleRef.current?.setAllCollapsed(next);
      return next;
    });
  }, [diffHandleRef]);
  // 折叠能力注册到共享 header trailing（与「未提交 / 已暂存」同一行）
  // 不在 cleanup 里清空：切面时旧面 cleanup 会抹掉新面刚注册的 chrome
  useEffect(() => {
    if (!active) {
      return;
    }
    onActiveChromeChange?.({
      allCollapsed,
      onToggleCollapseAll,
    });
  }, [active, allCollapsed, onActiveChromeChange, onToggleCollapseAll]);

  // 页签/摘要/工具条在共享壳 header；本面只渲染正文
  const emptyText =
    authoritativeEmpty &&
    gitReviewSurfaceIsMetaOnlyEmpty(entries, activeSurface)
      ? gitReviewSurfaceMetaOnlyEmptyText(context)
      : gitReviewSurfaceEmptyText(context, activeSurface);
  return (
    <GitReviewDocumentView
      appearance={appearance}
      authoritativeEmpty={authoritativeEmpty}
      {...(collidingFileLabel === undefined ? {} : { collidingFileLabel })}
      contentOnly
      context={context}
      contextId={scope.contextId}
      diffRef={setDiffHandle}
      emptyDescription={emptyText.description}
      emptySurface={activeSurface}
      emptyTitle={emptyText.title}
      {...(scope.target.kind === "uncommitted" ? { entries } : {})}
      failureSummary={failureSummary}
      feedbackEnabled={active}
      getSuppressMembershipScrollRestore={hasPendingNavigation}
      gitRootPath={scope.gitRootPath}
      {...(driftCommentLabels === undefined ? {} : { driftCommentLabels })}
      indexFailure={indexRefreshFailure}
      {...(isActiveOpenPath === undefined ? {} : { isActiveOpenPath })}
      {...(onContextMenuSession === undefined ? {} : { onContextMenuSession })}
      mutationAuthorityBlocked={mutationAuthorityBlocked}
      onAcquireMutationAuthority={onAcquireMutationAuthority}
      onFeedbackChange={updateRenderFeedback}
      {...(onGutterReviewActivate === undefined
        ? {}
        : { onGutterReviewActivate })}
      {...(onDriftCommentActivate === undefined
        ? {}
        : { onDriftCommentActivate })}
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
      {...(reviewCommentsById === undefined ? {} : { reviewCommentsById })}
      {...(activeReviewEpoch === undefined ? {} : { activeReviewEpoch })}
      {...(activeReviewSlotsByItem === undefined
        ? {}
        : { activeReviewSlotsByItem })}
      {...(inlineReviewHandlers === undefined ? {} : { inlineReviewHandlers })}
      {...(inlineReviewLabels === undefined ? {} : { inlineReviewLabels })}
      {...(inlineReviewThreadById === undefined
        ? {}
        : { inlineReviewThreadById })}
      renderFeedback={
        renderFeedback ??
        (replayFailure
          ? { error: replayFailure, retry: retryLatestItemUpdates }
          : null)
      }
      renderWindowReady={renderWindowReady}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      sourcePanelId={panelId}
      suppressMembershipScrollRestore={navigationPending}
      targetSelectionPending={targetSelectionPending}
      treeModel={treeModel}
      viewState={viewState}
      warnings={warnings}
    />
  );
}

/** 侧栏有文件但均为 pure rename / empty → 正文空态（二进制 notice 仍进列表）。 */
function gitReviewSurfaceIsMetaOnlyEmpty(
  entries: readonly GitReviewIndexEntry[],
  surface: GitReviewReadingSurface
): boolean {
  const groups = new Set(reviewGroupsForSurface(surface));
  const surfaceEntries = entries.filter((entry) =>
    entry.renderSlots.some((slot) => groups.has(slot.group))
  );
  if (surfaceEntries.length === 0) {
    return false;
  }
  return !surfaceEntries.some((entry) =>
    reviewEntryHasBodyContent(entry, surface)
  );
}

function gitReviewSurfaceMetaOnlyEmptyText(context: RendererPluginContext): {
  readonly description: string;
  readonly title: string;
} {
  return {
    description: pluginText(
      context,
      "reviewSurfacePathOnlyEmptyDescription",
      "These files only changed path or have no text diff. Use the sidebar to stage or open them."
    ),
    title: pluginText(
      context,
      "reviewSurfacePathOnlyEmptyTitle",
      "No text changes to show"
    ),
  };
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
