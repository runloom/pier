import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type {
  PierDiffViewHandle,
  PierDiffViewPresentation,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexOk,
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
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

interface GitReviewDocumentViewProps {
  readonly appearance: RendererPluginAppearance;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  readonly failureSummary: ReviewFailureSummary;
  readonly gitRootPath: string;
  readonly headerLeading?: React.ReactNode;
  readonly headerTrailing?: React.ReactNode;
  readonly indexFailure: GitReviewFailure | null;
  readonly navigationError: Error | null;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  readonly onItemError: (id: string, error: Error | null) => void;
  readonly onOpenPath: (path: string) => void;
  readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly onRetryFailure: (entryKey: string) => void;
  readonly onRetryIndex: () => void;
  readonly onRetryNavigation: () => void;
  readonly onScroll: () => void;
  readonly presentation?: PierDiffViewPresentation;
  readonly projection: ReviewDocumentProjection;
  readonly renderFeedback: ReviewRenderFeedback | null;
  readonly selectedTreePath: string | null;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sourcePanelId?: string;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly viewState: ReviewDocumentViewState;
  readonly warnings: GitReviewIndexOk["warnings"];
}

export function GitReviewDocumentView({
  appearance,
  context,
  diffRef,
  failureSummary,
  contextId,
  gitRootPath,
  headerLeading,
  headerTrailing,
  indexFailure,
  navigationError,
  onItemError,
  onFeedbackChange,
  onOpenPath,
  onRenderWindowChange,
  onRetryFailure,
  onRetryIndex,
  onRetryNavigation,
  onScroll,
  presentation,
  projection,
  renderFeedback,
  selectedTreePath,
  sourcePanelId,
  setSidebarCollapsed,
  sidebarCollapsed,
  sidebarFooter,
  treeModel,
  viewState,
  warnings,
}: GitReviewDocumentViewProps): React.JSX.Element {
  const diffContent = documentContent({
    appearance,
    context,
    diffRef,
    onItemError,
    onFeedbackChange,
    onRenderWindowChange,
    onScroll,
    ...(presentation === undefined ? {} : { presentation }),
    projection,
  });
  return (
    <GitReviewPanelLayout
      context={context}
      contextId={contextId}
      gitRootPath={gitRootPath}
      {...(headerLeading === undefined ? {} : { headerLeading })}
      {...(headerTrailing === undefined ? {} : { headerTrailing })}
      onOpenPath={onOpenPath}
      selectedTreePath={selectedTreePath}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      {...(sidebarFooter === undefined ? {} : { sidebarFooter })}
      {...(sourcePanelId ? { sourcePanelId } : {})}
      treeModel={treeModel}
    >
      <div className="flex h-full min-w-0 flex-col bg-background">
        {warnings.length > 0 ? (
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
        <ReviewFeedback
          context={context}
          failures={failureSummary.visibleFailures}
          hasHiddenFailures={failureSummary.hasHiddenFailures}
          indexFailure={indexFailure}
          navigationError={navigationError}
          onRetryFailure={onRetryFailure}
          onRetryIndex={onRetryIndex}
          onRetryNavigation={onRetryNavigation}
          {...(renderFeedback === null
            ? {}
            : { onRetryRender: renderFeedback.retry })}
          runtimeError={renderFeedback?.error ?? null}
          staleRetainedCount={viewState.staleRetainedCount}
        />
        {diffContent}
      </div>
    </GitReviewPanelLayout>
  );
}

function documentContent(options: {
  readonly appearance: RendererPluginAppearance;
  readonly context: RendererPluginContext;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  readonly onItemError: (id: string, error: Error | null) => void;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly onScroll: () => void;
  readonly presentation?: PierDiffViewPresentation;
  readonly projection: ReviewDocumentProjection;
}): React.JSX.Element {
  if (options.projection.items.length > 0) {
    return (
      <div className="min-h-0 flex-1">
        <ReviewCodeView
          appearance={options.appearance}
          context={options.context}
          diffRef={options.diffRef}
          items={options.projection.items}
          onFeedbackChange={options.onFeedbackChange}
          onItemError={options.onItemError}
          onRenderWindowChange={options.onRenderWindowChange}
          onScroll={options.onScroll}
          {...(options.presentation === undefined
            ? {}
            : { presentation: options.presentation })}
        />
      </div>
    );
  }
  return <ReviewLoading context={options.context} />;
}
