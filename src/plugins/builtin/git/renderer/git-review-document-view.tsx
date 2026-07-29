import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type {
  PierDiffViewHandle,
  PierDiffViewPresentation,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewMutationOk,
} from "@shared/contracts/git-review.ts";
import { pluginText } from "./git-plugin-text.ts";
import {
  ReviewCodeView,
  type ReviewRenderFeedback,
} from "./git-review-code-view.tsx";
import type {
  ReviewDocumentProjection,
  ReviewDocumentViewState,
} from "./git-review-document-projection.ts";
import type { ReviewFailureSummary } from "./git-review-failure-state.ts";
import { ReviewFeedback, ReviewLoading } from "./git-review-feedback.tsx";
import { gitReviewWarningMessage } from "./git-review-message.ts";
import { GitReviewPanelLayout } from "./git-review-panel-layout.tsx";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
  GitReviewReadingSurface,
} from "./git-review-reading-surface.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

interface GitReviewDocumentViewProps {
  readonly appearance: RendererPluginAppearance;
  readonly authoritativeEmpty: boolean;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  readonly emptyDescription: string;
  readonly emptySurface: GitReviewReadingSurface;
  readonly emptyTitle: string;
  /** Uncommitted entries enable header stage checkbox. */
  readonly entries?: readonly GitReviewIndexEntry[];
  readonly failureSummary: ReviewFailureSummary;
  readonly feedbackEnabled: boolean;
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly gitRootPath: string;
  readonly headerCenter?: React.ReactNode;
  readonly headerLeading?: React.ReactNode;
  readonly headerTrailing?: React.ReactNode;
  readonly indexFailure: GitReviewFailure | null;
  readonly isActiveOpenPath?: (path: string) => boolean;
  readonly mutationAuthorityBlocked: boolean;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onContextMenuSession?: (
    phase: "begin" | "end",
    detail: {
      readonly intent: "inspect" | "command";
      readonly path: string;
    }
  ) => void;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  readonly onItemError: (id: string, error: Error | null) => void;
  readonly onMutationCommitted: (
    result: GitReviewMutationOk | null,
    transition?: GitReviewMutationTransition
  ) => Promise<void>;
  readonly onOpenPath: (path: string) => void;
  readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly onRetryFailure: (entryKey: string) => void;
  readonly onRetryIndex: () => void;
  readonly onScroll: () => void;
  readonly presentation?: PierDiffViewPresentation;
  readonly projection: ReviewDocumentProjection;
  readonly renderFeedback: ReviewRenderFeedback | null;
  readonly renderWindowReady: boolean;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sidebarHeader?: React.ReactNode;
  readonly sourcePanelId?: string;
  readonly suppressMembershipScrollRestore?: boolean;
  readonly targetSelectionPending?: boolean;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly viewState: ReviewDocumentViewState;
  readonly warnings: GitReviewIndexOk["warnings"];
}

export function GitReviewDocumentView({
  appearance,
  authoritativeEmpty,
  context,
  diffRef,
  emptyDescription,
  emptySurface,
  emptyTitle,
  entries,
  failureSummary,
  feedbackEnabled,
  contextId,
  gitRootPath,
  headerCenter,
  headerLeading,
  headerTrailing,
  indexFailure,
  onItemError,
  onFeedbackChange,
  onAcquireMutationAuthority,
  onMutationCommitted,
  mutationAuthorityBlocked,
  onOpenPath,
  isActiveOpenPath,
  onContextMenuSession,
  onRenderWindowChange,
  onRetryFailure,
  onRetryIndex,
  onScroll,
  presentation,
  projection,
  renderFeedback,
  renderWindowReady,
  sourcePanelId,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  sidebarHeader,
  getSuppressMembershipScrollRestore,
  suppressMembershipScrollRestore = false,
  targetSelectionPending = false,
  treeModel,
  viewState,
  warnings,
}: GitReviewDocumentViewProps): React.JSX.Element {
  const diffContent = targetSelectionPending ? (
    <ReviewLoading context={context} />
  ) : (
    documentContent({
      appearance,
      authoritativeEmpty,
      context,
      contextId,
      diffRef,
      emptyDescription,
      emptySurface,
      emptyTitle,
      ...(entries === undefined ? {} : { entries }),
      gitRootPath,
      onItemError,
      onFeedbackChange,
      onAcquireMutationAuthority,
      onMutationCommitted,
      mutationAuthorityBlocked,
      onRenderWindowChange,
      onScroll,
      ...(presentation === undefined ? {} : { presentation }),
      projection,
      renderErrorVisible: renderFeedback !== null,
      renderWindowReady,
      settled: viewState.settled,
      ...(sourcePanelId === undefined ? {} : { sourcePanelId }),
      ...(getSuppressMembershipScrollRestore === undefined
        ? {}
        : { getSuppressMembershipScrollRestore }),
      suppressMembershipScrollRestore,
    })
  );

  return (
    <GitReviewPanelLayout
      context={context}
      contextId={contextId}
      gitRootPath={gitRootPath}
      mutationAuthorityBlocked={
        mutationAuthorityBlocked || targetSelectionPending
      }
      {...(headerCenter === undefined ? {} : { headerCenter })}
      {...(headerLeading === undefined ? {} : { headerLeading })}
      {...(headerTrailing === undefined ? {} : { headerTrailing })}
      onOpenPath={onOpenPath}
      {...(isActiveOpenPath ? { isActiveOpenPath } : {})}
      {...(onContextMenuSession ? { onContextMenuSession } : {})}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
      {...(sidebarHeader === undefined ? {} : { sidebarHeader })}
      {...(sourcePanelId ? { sourcePanelId } : {})}
      treeModel={targetSelectionPending ? null : treeModel}
    >
      <div
        className="flex h-full min-w-0 flex-col bg-background"
        data-git-review-document-settled={viewState.settled}
      >
        {!targetSelectionPending && warnings.length > 0 ? (
          <Alert className="m-2">
            <AlertTitle>
              {pluginText(context, "reviewPartialTitle", "Partial results")}
            </AlertTitle>
            <AlertDescription>
              {warnings
                .map((warning) => gitReviewWarningMessage(context, warning))
                .join(" ")}
            </AlertDescription>
          </Alert>
        ) : null}
        {targetSelectionPending ? null : (
          <ReviewFeedback
            context={context}
            enabled={feedbackEnabled}
            failures={failureSummary.visibleFailures}
            hasHiddenFailures={failureSummary.hasHiddenFailures}
            indexFailure={indexFailure}
            onRetryFailure={onRetryFailure}
            onRetryIndex={onRetryIndex}
            {...(renderFeedback === null
              ? {}
              : { onRetryRender: renderFeedback.retry })}
            runtimeError={renderFeedback?.error ?? null}
            staleRetainedCount={viewState.staleRetainedCount}
          />
        )}
        {diffContent}
      </div>
    </GitReviewPanelLayout>
  );
}

function documentContent(options: {
  readonly appearance: RendererPluginAppearance;
  readonly authoritativeEmpty: boolean;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  readonly emptyDescription: string;
  readonly emptySurface: GitReviewReadingSurface;
  readonly emptyTitle: string;
  readonly entries?: readonly GitReviewIndexEntry[];
  readonly gitRootPath: string;
  readonly onItemError: (id: string, error: Error | null) => void;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onMutationCommitted: (
    result: GitReviewMutationOk | null,
    transition?: GitReviewMutationTransition
  ) => Promise<void>;
  readonly mutationAuthorityBlocked: boolean;
  readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly onScroll: () => void;
  readonly presentation?: PierDiffViewPresentation;
  readonly projection: ReviewDocumentProjection;
  readonly renderErrorVisible: boolean;
  readonly renderWindowReady: boolean;
  readonly settled: boolean;
  readonly sourcePanelId?: string;
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly suppressMembershipScrollRestore?: boolean;
}): React.JSX.Element {
  const suppress = options.suppressMembershipScrollRestore === true;
  const firstProjectionItem = options.projection.items[0];
  const firstItemRenderable =
    firstProjectionItem !== undefined &&
    firstProjectionItem.kind !== "estimate";
  // 未提交视图需要让隐藏的 Pierre 尽早提交首屏 window demand，并保留
  // stable-ledger 导航；但 estimate 只能作为内部高度预算，不能成为可见正文。
  const canMountProjection =
    firstItemRenderable ||
    (options.entries !== undefined && options.projection.items.length > 0);
  const projectionVisible =
    options.renderWindowReady || options.renderErrorVisible;
  const suppressGetter =
    options.getSuppressMembershipScrollRestore === undefined
      ? {}
      : {
          getSuppressMembershipScrollRestore:
            options.getSuppressMembershipScrollRestore,
        };
  if (canMountProjection) {
    return (
      <div
        className="relative min-h-0 flex-1"
        data-git-review-document-content={
          projectionVisible ? "code" : "loading"
        }
      >
        <div
          aria-hidden={!projectionVisible}
          className={cn("h-full", !projectionVisible && "invisible")}
          inert={projectionVisible ? undefined : true}
        >
          <ReviewCodeView
            appearance={options.appearance}
            context={options.context}
            contextId={options.contextId}
            diffRef={options.diffRef}
            {...(options.entries === undefined
              ? {}
              : { entries: options.entries })}
            {...(options.gitRootPath
              ? { gitRootPath: options.gitRootPath }
              : {})}
            items={options.projection.items}
            mutationAuthorityBlocked={options.mutationAuthorityBlocked}
            onAcquireMutationAuthority={options.onAcquireMutationAuthority}
            onFeedbackChange={options.onFeedbackChange}
            onItemError={options.onItemError}
            onMutationCommitted={options.onMutationCommitted}
            onRenderWindowChange={options.onRenderWindowChange}
            onScroll={options.onScroll}
            revisionBySectionId={options.projection.revisionBySectionId}
            {...(options.presentation === undefined
              ? {}
              : { presentation: options.presentation })}
            {...(options.sourcePanelId === undefined
              ? {}
              : { sourcePanelId: options.sourcePanelId })}
            {...suppressGetter}
            suppressMembershipScrollRestore={suppress}
          />
        </div>
        {projectionVisible ? null : (
          <div className="absolute inset-0">
            <ReviewLoading context={options.context} />
          </div>
        )}
      </div>
    );
  }
  if (!(options.settled || options.authoritativeEmpty)) {
    return <ReviewLoading context={options.context} />;
  }
  return (
    <Empty
      className="min-h-0 flex-1"
      data-git-review-document-content="empty"
      data-git-review-empty-surface={options.emptySurface}
      data-git-review-empty-title={options.emptyTitle}
    >
      <EmptyHeader>
        <EmptyTitle>{options.emptyTitle}</EmptyTitle>
        <EmptyDescription>{options.emptyDescription}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
