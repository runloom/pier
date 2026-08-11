import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type {
  PierDiffReviewCommentThread,
  PierDiffViewHandle,
  PierDiffViewPresentation,
  PierDiffViewProps,
  PierDiffViewRenderWindow,
  PierDriftCommentLabels,
  PierGutterReviewEvent,
} from "@pier/ui/diff-view/index.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewMutationOk,
} from "@shared/contracts/git/review.ts";
import { pluginText } from "../../plugin-text.ts";
import { ReviewCodeView, type ReviewRenderFeedback } from "../code-view.tsx";
import type { ReviewFailureSummary } from "../failure-state.ts";
import { ReviewFeedback, ReviewLoading } from "../feedback.tsx";
import { gitReviewWarningMessage } from "../message.ts";
import { GitReviewPanelLayout } from "../panel-layout.tsx";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
  GitReviewReadingSurface,
} from "../reading-surface.ts";
import type { gitReviewTreeModel } from "../tree.tsx";
import { GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS } from "./hydrate-timeout.ts";
import type {
  ReviewDocumentProjection,
  ReviewDocumentViewState,
} from "./projection.ts";
import { projectReviewLedger } from "./projection.ts";

interface GitReviewDocumentViewProps {
  readonly activeReviewEpoch?: PierDiffViewProps["activeReviewEpoch"];
  readonly activeReviewSlotsByItem?: PierDiffViewProps["activeReviewSlotsByItem"];
  readonly appearance: RendererPluginAppearance;
  readonly authoritativeEmpty: boolean;
  /**
   * 多阅读面共享侧栏时：只渲染正文（树/壳在父级）。
   * 默认 full：自带 PanelLayout + 树（loading/empty 等单壳场景）。
   */
  readonly collidingFileLabel?: (name: string) => string;
  readonly contentOnly?: boolean;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  /** drift 评论 chip aria/title 文案（透传 ReviewCodeView → PierDiffView）。 */
  readonly driftCommentLabels?: PierDriftCommentLabels;
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
  readonly inlineReviewHandlers?: PierDiffViewProps["inlineReviewHandlers"];
  readonly inlineReviewLabels?: PierDiffViewProps["inlineReviewLabels"];
  readonly inlineReviewThreadById?: PierDiffViewProps["inlineReviewThreadById"];
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
  /** drift 评论 chip 点击（透传 ReviewCodeView → PierDiffView）。 */
  readonly onDriftCommentActivate?: (threadId: string) => void;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  /**
   * Diff 行内评论 gutter 入口激活（透传 ReviewCodeView → PierDiffView）。
   * 提供即开启原生 gutter `+` 入口（在该行新建评论草稿）。
   */
  readonly onGutterReviewActivate?: (event: PierGutterReviewEvent) => void;
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
  /**
   * itemId → 该文件 diff 行内评论线程（透传 ReviewCodeView → PierDiffView）。
   * gutter 按 (side, line) 查询渲染入口；缺省无评论入口。
   */
  readonly reviewCommentsById?: ReadonlyMap<
    string,
    readonly PierDiffReviewCommentThread[]
  >;
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
  collidingFileLabel,
  contentOnly = false,
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
  driftCommentLabels,
  activeReviewEpoch,
  activeReviewSlotsByItem,
  inlineReviewHandlers,
  inlineReviewLabels,
  inlineReviewThreadById,
  headerCenter,
  headerLeading,
  headerTrailing,
  indexFailure,
  onItemError,
  onFeedbackChange,
  onGutterReviewActivate,
  onDriftCommentActivate,
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
  reviewCommentsById,
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
      ...(collidingFileLabel === undefined ? {} : { collidingFileLabel }),
      context,
      contextId,
      diffRef,
      emptyDescription,
      emptySurface,
      emptyTitle,
      ...(entries === undefined ? {} : { entries }),
      failureSummary,
      gitRootPath,
      ...(driftCommentLabels === undefined ? {} : { driftCommentLabels }),
      onItemError,
      onFeedbackChange,
      ...(onGutterReviewActivate === undefined
        ? {}
        : { onGutterReviewActivate }),
      ...(onDriftCommentActivate === undefined
        ? {}
        : { onDriftCommentActivate }),
      onAcquireMutationAuthority,
      onMutationCommitted,
      mutationAuthorityBlocked,
      onRenderWindowChange,
      onRetryFailure,
      onScroll,
      ...(presentation === undefined ? {} : { presentation }),
      projection,
      ...(reviewCommentsById === undefined ? {} : { reviewCommentsById }),
      ...(activeReviewEpoch === undefined ? {} : { activeReviewEpoch }),
      ...(activeReviewSlotsByItem === undefined
        ? {}
        : { activeReviewSlotsByItem }),
      ...(inlineReviewHandlers === undefined ? {} : { inlineReviewHandlers }),
      ...(inlineReviewLabels === undefined ? {} : { inlineReviewLabels }),
      ...(inlineReviewThreadById === undefined
        ? {}
        : { inlineReviewThreadById }),
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

  const body = (
    <div
      className="flex h-full min-w-0 flex-col bg-background"
      data-git-review-body-hydrate-timeout-ms={String(
        GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS
      )}
      data-git-review-document-settled={viewState.settled}
      data-git-review-navigation-gate="false"
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
          softRetainedOnly={failureSummary.softRetainedOnly}
          staleRetainedCount={viewState.staleRetainedCount}
        />
      )}
      {diffContent}
    </div>
  );

  if (contentOnly) {
    return body;
  }

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
      {body}
    </GitReviewPanelLayout>
  );
}

function documentContent(options: {
  readonly appearance: RendererPluginAppearance;
  readonly authoritativeEmpty: boolean;
  readonly collidingFileLabel?: (name: string) => string;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly diffRef: (handle: PierDiffViewHandle | null) => void;
  readonly emptyDescription: string;
  readonly emptySurface: GitReviewReadingSurface;
  readonly emptyTitle: string;
  readonly entries?: readonly GitReviewIndexEntry[];
  readonly failureSummary: ReviewFailureSummary;
  readonly gitRootPath: string;
  readonly driftCommentLabels?: PierDriftCommentLabels;
  readonly onItemError: (id: string, error: Error | null) => void;
  readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
  readonly onGutterReviewActivate?: (event: PierGutterReviewEvent) => void;
  readonly onDriftCommentActivate?: (threadId: string) => void;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onMutationCommitted: (
    result: GitReviewMutationOk | null,
    transition?: GitReviewMutationTransition
  ) => Promise<void>;
  readonly mutationAuthorityBlocked: boolean;
  readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly onRetryFailure: (entryKey: string) => void;
  readonly onScroll: () => void;
  readonly presentation?: PierDiffViewPresentation;
  readonly projection: ReviewDocumentProjection;
  readonly reviewCommentsById?: ReadonlyMap<
    string,
    readonly PierDiffReviewCommentThread[]
  >;
  readonly activeReviewEpoch?: PierDiffViewProps["activeReviewEpoch"];
  readonly activeReviewSlotsByItem?: PierDiffViewProps["activeReviewSlotsByItem"];
  readonly inlineReviewHandlers?: PierDiffViewProps["inlineReviewHandlers"];
  readonly inlineReviewLabels?: PierDiffViewProps["inlineReviewLabels"];
  readonly inlineReviewThreadById?: PierDiffViewProps["inlineReviewThreadById"];
  readonly renderErrorVisible: boolean;
  readonly renderWindowReady: boolean;
  readonly settled: boolean;
  readonly sourcePanelId?: string;
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly suppressMembershipScrollRestore?: boolean;
}): React.JSX.Element {
  const suppress = options.suppressMembershipScrollRestore === true;
  const handleRetryItem = (sectionKey: string) => {
    // item.id === sectionKey；error 槽行内 Retry → loader.retry(entryKey)
    const candidates = [
      ...(options.entries ?? []),
      ...options.failureSummary.visibleFailures.map(
        (resource) => resource.entry
      ),
    ];
    for (const entry of candidates) {
      if (entry.renderSlots.some((slot) => slot.sectionKey === sectionKey)) {
        options.onRetryFailure(entry.entryKey);
        return;
      }
    }
  };
  // generation effect 首帧前 projection 可能仍为空。
  // 冷路径：全 content 槽挂 estimate，保证折叠/滚动总高 = n×header 坐标系。
  let displayProjection = options.projection;
  if (
    displayProjection.items.length === 0 &&
    options.entries !== undefined &&
    options.entries.length > 0 &&
    !options.authoritativeEmpty
  ) {
    displayProjection = projectReviewLedger({
      ...(options.collidingFileLabel === undefined
        ? {}
        : { collidingFileLabel: options.collidingFileLabel }),
      context: options.context,
      diffBase: options.emptySurface,
      entries: options.entries,
      locale: options.appearance.locale,
      resourceByEntryKey: new Map(),
      sourceIndexGeneration: options.projection.sourceIndexGeneration,
    });
  }
  const suppressGetter =
    options.getSuppressMembershipScrollRestore === undefined
      ? {}
      : {
          getSuppressMembershipScrollRestore:
            options.getSuppressMembershipScrollRestore,
        };
  if (displayProjection.items.length > 0) {
    return (
      <div
        className="relative min-h-0 flex-1"
        data-git-review-document-content={
          options.renderWindowReady || options.renderErrorVisible
            ? "code"
            : "loading"
        }
      >
        <div className="h-full">
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
            {...(options.driftCommentLabels === undefined
              ? {}
              : { driftCommentLabels: options.driftCommentLabels })}
            items={displayProjection.items}
            {...(options.reviewCommentsById === undefined
              ? {}
              : { reviewCommentsById: options.reviewCommentsById })}
            {...(options.activeReviewEpoch === undefined
              ? {}
              : { activeReviewEpoch: options.activeReviewEpoch })}
            {...(options.activeReviewSlotsByItem === undefined
              ? {}
              : {
                  activeReviewSlotsByItem: options.activeReviewSlotsByItem,
                })}
            {...(options.inlineReviewHandlers === undefined
              ? {}
              : {
                  inlineReviewHandlers: options.inlineReviewHandlers,
                })}
            {...(options.inlineReviewLabels === undefined
              ? {}
              : { inlineReviewLabels: options.inlineReviewLabels })}
            {...(options.inlineReviewThreadById === undefined
              ? {}
              : {
                  inlineReviewThreadById: options.inlineReviewThreadById,
                })}
            mutationAuthorityBlocked={options.mutationAuthorityBlocked}
            onAcquireMutationAuthority={options.onAcquireMutationAuthority}
            onFeedbackChange={options.onFeedbackChange}
            {...(options.onGutterReviewActivate === undefined
              ? {}
              : { onGutterReviewActivate: options.onGutterReviewActivate })}
            {...(options.onDriftCommentActivate === undefined
              ? {}
              : { onDriftCommentActivate: options.onDriftCommentActivate })}
            onItemError={options.onItemError}
            onMutationCommitted={options.onMutationCommitted}
            onRenderWindowChange={options.onRenderWindowChange}
            onRetryItem={handleRetryItem}
            onScroll={options.onScroll}
            revisionBySectionId={displayProjection.revisionBySectionId}
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
