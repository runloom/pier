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
  GitReviewIndexEntry,
  GitReviewMutationOk,
} from "@shared/contracts/git/review.ts";
import { ReviewCodeView, type ReviewRenderFeedback } from "../code-view.tsx";
import type { ReviewFailureSummary } from "../failure-state.ts";
import { ReviewLoading } from "../feedback.tsx";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
  GitReviewReadingSurface,
} from "../reading-surface.ts";
import { resolveReviewDocumentBody } from "./conflict-focus.ts";
import type { ReviewDocumentProjection } from "./projection.ts";
import { projectReviewLedger } from "./projection.ts";

export function documentContent(options: {
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
  readonly selectedSectionKey?: string | null;
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
    const body = resolveReviewDocumentBody(
      displayProjection.items,
      options.emptySurface
    );

    return (
      <div
        className="relative min-h-0 flex-1"
        data-git-review-document-content={
          options.renderWindowReady || options.renderErrorVisible
            ? "code"
            : "loading"
        }
      >
        <div className="h-full min-h-0">
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
            items={body.items}
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
            {...(options.selectedSectionKey
              ? { selectedSectionKey: options.selectedSectionKey }
              : {})}
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
