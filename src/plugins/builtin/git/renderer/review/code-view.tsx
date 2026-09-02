import type {
  PierDiffReviewCommentThread,
  PierDiffViewHandle,
  PierDiffViewImageDiff,
  PierDiffViewItem,
  PierDiffViewPresentation,
  PierDiffViewProps,
  PierDiffViewRenderWindow,
  PierDriftCommentLabels,
  PierGutterReviewEvent,
  PierImageDiffLocator,
} from "@pier/ui/diff-view/index.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewMutationOk,
} from "@shared/contracts/git/review.ts";
import {
  Component,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GIT_CHANGES_PANEL_ID } from "../../manifest.ts";
import { useGitReviewCodeMutations } from "../hooks/use-code-mutations.ts";
import { pluginText } from "../plugin-text.ts";
import { usePluginLanguage } from "../use-plugin-language.ts";
import { openGitReviewDiffContextMenu } from "./diff-context-menu.ts";
import { resolveGitReviewLiveCopyTarget } from "./diff-open-target.ts";
import { useReviewUnresolvedConflictHost } from "./document/conflict-host.tsx";
import { ReviewErrorEmpty, ReviewLoading } from "./feedback.tsx";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
} from "./reading-surface.ts";
import { registerGitReviewLiveCopyTarget } from "./tree-path-actions.ts";

const loadPierDiffView = () =>
  import("@pier/ui/diff-view/index.tsx").then((module) => ({
    default: module.PierDiffView,
  }));

export function preloadReviewCodeView(): void {
  loadPierDiffView().catch(() => undefined);
}

class ReviewCodeViewLoadBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly onError: (error: Error) => void;
  },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

type ReviewCodeViewModuleLoader = typeof loadPierDiffView;

export interface ReviewRenderFeedback {
  readonly error: Error;
  readonly retry: () => void;
}

export function createReviewCodeView(load: ReviewCodeViewModuleLoader) {
  // 模块级 lazy：panel unmount remount 不重新 suspend 到整区 Loading。
  let sharedView: LazyExoticComponent<
    (props: PierDiffViewProps) => React.JSX.Element | null
  > | null = null;
  const getSharedView = () => {
    if (!sharedView) {
      sharedView = lazy(load);
    }
    return sharedView;
  };
  return function ReviewCodeView({
    appearance,
    driftCommentLabels,
    activeReviewEpoch,
    activeReviewSlotsByItem,
    inlineReviewHandlers,
    inlineReviewLabels,
    inlineReviewThreadById,
    context,
    contextId,
    diffRef,
    entries,
    gitRootPath,
    items,
    mutationAuthorityBlocked,
    onFeedbackChange,
    onAcquireMutationAuthority,
    onGutterReviewActivate,
    onDriftCommentActivate,
    onItemError,
    onMutationCommitted,
    onRenderWindowChange,
    onRetryItem,
    onScroll,
    presentation,
    reviewCommentsById,
    revisionBySectionId,
    selectedSectionKey,
    sourcePanelId,
    getSuppressMembershipScrollRestore,
    suppressMembershipScrollRestore = false,
  }: {
    readonly appearance: RendererPluginAppearance;
    readonly driftCommentLabels?: PierDriftCommentLabels;
    readonly context: RendererPluginContext;
    readonly contextId: string;
    readonly diffRef: (handle: PierDiffViewHandle | null) => void;
    /** Uncommitted index entries for header stage toggle; omit for read-only scopes. */
    readonly entries?: readonly GitReviewIndexEntry[];
    readonly gitRootPath?: string;
    readonly items: readonly PierDiffViewItem[];
    readonly mutationAuthorityBlocked: boolean;
    readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
    readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
    readonly onGutterReviewActivate?: (event: PierGutterReviewEvent) => void;
    readonly onDriftCommentActivate?: (threadId: string) => void;
    readonly onItemError?: (id: string, error: Error | null) => void;
    readonly onMutationCommitted?: (
      result: GitReviewMutationOk | null,
      transition?: GitReviewMutationTransition
    ) => Promise<void>;
    readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
    /** error 槽行内重试（sectionKey → 宿主 entry retry） */
    readonly onRetryItem?: (itemId: string) => void;
    readonly onScroll: () => void;
    readonly presentation?: PierDiffViewPresentation;
    readonly reviewCommentsById?: ReadonlyMap<
      string,
      readonly PierDiffReviewCommentThread[]
    >;
    readonly activeReviewEpoch?: PierDiffViewProps["activeReviewEpoch"];
    readonly activeReviewSlotsByItem?: PierDiffViewProps["activeReviewSlotsByItem"];
    readonly inlineReviewHandlers?: PierDiffViewProps["inlineReviewHandlers"];
    readonly inlineReviewLabels?: PierDiffViewProps["inlineReviewLabels"];
    readonly inlineReviewThreadById?: PierDiffViewProps["inlineReviewThreadById"];
    readonly revisionBySectionId: ReadonlyMap<string, string>;
    readonly selectedSectionKey?: string | null;
    readonly sourcePanelId?: string;
    readonly getSuppressMembershipScrollRestore?: () => boolean;
    readonly suppressMembershipScrollRestore?: boolean;
  }): React.JSX.Element {
    const language = usePluginLanguage();
    const handleRef = useRef<PierDiffViewHandle | null>(null);
    const [runtimeError, setRuntimeError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(() => ({
      id: 0,
      View: getSharedView(),
    }));
    const LazyPierDiffView = attempt.View;
    const retry = useCallback(() => {
      setRuntimeError(null);
      // 失败重试仍换新 lazy 实例；成功路径继续共享模块级 View。
      sharedView = lazy(load);
      setAttempt((current) => ({
        id: current.id + 1,
        View: sharedView as NonNullable<typeof sharedView>,
      }));
    }, []);
    useEffect(() => {
      onFeedbackChange(
        runtimeError === null ? null : { error: runtimeError, retry }
      );
      return () => onFeedbackChange(null);
    }, [onFeedbackChange, retry, runtimeError]);

    const {
      canMutate,
      displayItems,
      onDiscardFile,
      onHunkAction,
      onOpenFile,
      onToggleStage,
    } = useGitReviewCodeMutations({
      captureReadingAnchor: (itemId) =>
        handleRef.current?.captureItemAnchor?.(itemId) ?? null,
      context,
      contextId,
      items,
      mutationBlocked: mutationAuthorityBlocked,
      onMutationStart: onAcquireMutationAuthority,
      revisionBySectionId,
      ...(onMutationCommitted === undefined ? {} : { onMutationCommitted }),
      ...(entries === undefined ? {} : { entries }),
      ...(gitRootPath === undefined ? {} : { gitRootPath }),
    });

    const unresolvedConflict = useReviewUnresolvedConflictHost({
      context,
      contextId,
      items: displayItems,
      mutationLocked: mutationAuthorityBlocked,
      ...(gitRootPath === undefined ? {} : { gitRootPath }),
      ...(onMutationCommitted === undefined ? {} : { onMutationCommitted }),
    });

    const setDiffHandle = useCallback(
      (handle: PierDiffViewHandle | null) => {
        handleRef.current = handle;
        diffRef(handle);
      },
      [diffRef]
    );

    const handleDiffContextMenu = useCallback(
      (event: React.MouseEvent<HTMLFieldSetElement>) => {
        if (!gitRootPath) {
          return;
        }
        openGitReviewDiffContextMenu({
          context,
          contextId,
          event,
          gitRootPath,
          handle: handleRef.current,
          items: displayItems,
          sourcePanelComponent: GIT_CHANGES_PANEL_ID,
          sourcePanelContext: context.panels.getActiveContext(),
          ...(sourcePanelId === undefined ? {} : { sourcePanelId }),
        });
      },
      [context, contextId, displayItems, gitRootPath, sourcePanelId]
    );

    useEffect(() => {
      if (!(gitRootPath && sourcePanelId)) {
        return;
      }
      return registerGitReviewLiveCopyTarget(sourcePanelId, () =>
        resolveGitReviewLiveCopyTarget({
          gitRootPath,
          handle: handleRef.current,
          items: displayItems,
          ...(selectedSectionKey
            ? { preferredItemId: selectedSectionKey }
            : {}),
        })
      );
    }, [displayItems, gitRootPath, selectedSectionKey, sourcePanelId]);

    // Rebuild tooltip/aria labels when host locale switches.
    // biome-ignore lint/correctness/useExhaustiveDependencies: language drives i18n re-read
    const diffLabels = useMemo(
      () => ({
        collapseDiff: pluginText(
          context,
          "reviewCollapseDiff",
          "Collapse diff"
        ),
        discardChanges: pluginText(
          context,
          "reviewHeaderRestore",
          "Discard Changes"
        ),
        expandAllUnmodified: pluginText(
          context,
          "reviewExpandAllUnmodified",
          "Expand all"
        ),
        expandDiff: pluginText(context, "reviewExpandDiff", "Expand diff"),
        // File-scoped header title click (line/selection uses Jump to Source).
        openFile: pluginText(context, "reviewOpenFile", "Open File"),
        retry: pluginText(context, "reviewRetry", "Retry"),
        revertHunk: pluginText(context, "reviewHunkRevert", "Revert"),
        stageChanges: pluginText(context, "reviewHeaderStage", "Stage"),
        stageHunk: pluginText(context, "reviewHunkStage", "Stage"),
        stageRemainingHunk: pluginText(
          context,
          "reviewHunkStageRemaining",
          "Stage Remaining Changes"
        ),
        // Patched @pierre/diffs formatUnmodifiedLines; templates use {{count}}.
        unmodifiedLine: pluginText(
          context,
          "reviewUnmodifiedLine",
          "{{count}} unmodified line"
        ),
        unmodifiedLines: pluginText(
          context,
          "reviewUnmodifiedLines",
          "{{count}} unmodified lines"
        ),
        unstageChanges: pluginText(context, "reviewHeaderUnstage", "Unstage"),
        unstageHunk: pluginText(context, "reviewHunkUnstage", "Unstage"),
      }),
      [context, language]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: language drives i18n re-read
    const imageDiff = useMemo<PierDiffViewImageDiff>(
      () => ({
        labels: {
          added: pluginText(context, "reviewImageDiffAdded", "Added"),
          compare: pluginText(context, "reviewImageDiffCompare", "Compare"),
          deleted: pluginText(context, "reviewImageDiffDeleted", "Deleted"),
          dimensions: pluginText(
            context,
            "reviewImageDiffDimensions",
            "{{width}}×{{height}}"
          ),
          loadFailed: pluginText(
            context,
            "reviewImageDiffLoadFailed",
            "Couldn't load this image. Open the file to inspect."
          ),
          onionSkin: pluginText(
            context,
            "reviewImageDiffOnionSkin",
            "Onion skin"
          ),
          swipe: pluginText(context, "reviewImageDiffSwipe", "Swipe"),
          twoUp: pluginText(context, "reviewImageDiffTwoUp", "2-up"),
        },
        locale: appearance.locale,
        release: (ticket) => {
          context.filePreviews.release(ticket).catch(() => undefined);
        },
        resolve: async (locator) => {
          const issued = await context.filePreviews.issue(
            filePreviewLocatorFromImageDiff(locator)
          );
          if (!issued.issued) {
            return null;
          }
          return { ticket: issued.ticket, url: issued.url };
        },
      }),
      [appearance.locale, context, language]
    );

    return (
      <fieldset
        aria-busy={mutationAuthorityBlocked}
        className="m-0 h-full min-h-0 min-w-0 border-0 p-0"
        data-git-review-mutation-blocked={mutationAuthorityBlocked}
        disabled={mutationAuthorityBlocked}
        {...(gitRootPath ? { onContextMenu: handleDiffContextMenu } : {})}
      >
        {runtimeError ? (
          // 渲染层崩溃时正文全空白:错误就是内容本身,用 Empty 全区呈现。
          <ReviewErrorEmpty
            context={context}
            detail={runtimeError.message}
            onRetry={retry}
            title={pluginText(
              context,
              "reviewRenderFailed",
              "Failed to render diff"
            )}
          />
        ) : (
          <ReviewCodeViewLoadBoundary
            key={attempt.id}
            onError={setRuntimeError}
          >
            <Suspense fallback={<ReviewLoading context={context} />}>
              <LazyPierDiffView
                appearance={{
                  codeFontFamily: appearance.typography.codeFontFamily,
                  codeFontSize: appearance.typography.codeFontSize,
                  codeThemes: appearance.codeThemes,
                  colorMode: appearance.theme,
                }}
                imageDiff={imageDiff}
                items={displayItems}
                labels={diffLabels}
                {...(unresolvedConflict === undefined
                  ? {}
                  : { unresolvedConflict })}
                {...(driftCommentLabels === undefined
                  ? {}
                  : { driftCommentLabels })}
                onError={setRuntimeError}
                {...(onGutterReviewActivate === undefined
                  ? {}
                  : { onGutterReviewActivate })}
                {...(onDriftCommentActivate === undefined
                  ? {}
                  : { onDriftCommentActivate })}
                {...(onItemError === undefined ? {} : { onItemError })}
                {...(gitRootPath ? { onOpenFile } : {})}
                onRenderWindowChange={onRenderWindowChange}
                {...(onRetryItem === undefined ? {} : { onRetryItem })}
                onScroll={onScroll}
                {...(canMutate
                  ? {
                      onDiscardFile,
                      onHunkAction,
                      onToggleStage,
                    }
                  : {})}
                {...(presentation === undefined ? {} : { presentation })}
                {...(reviewCommentsById === undefined
                  ? {}
                  : { reviewCommentsById })}
                {...(activeReviewEpoch === undefined
                  ? {}
                  : { activeReviewEpoch })}
                {...(activeReviewSlotsByItem === undefined
                  ? {}
                  : { activeReviewSlotsByItem })}
                {...(inlineReviewHandlers === undefined
                  ? {}
                  : { inlineReviewHandlers })}
                {...(inlineReviewLabels === undefined
                  ? {}
                  : { inlineReviewLabels })}
                {...(inlineReviewThreadById === undefined
                  ? {}
                  : { inlineReviewThreadById })}
                locale={appearance.locale}
                ref={setDiffHandle}
                {...(getSuppressMembershipScrollRestore === undefined
                  ? {}
                  : { getSuppressMembershipScrollRestore })}
                suppressMembershipScrollRestore={
                  suppressMembershipScrollRestore
                }
              />
            </Suspense>
          </ReviewCodeViewLoadBoundary>
        )}
      </fieldset>
    );
  };
}

export const ReviewCodeView = createReviewCodeView(loadPierDiffView);

function filePreviewLocatorFromImageDiff(
  locator: PierImageDiffLocator
): Parameters<RendererPluginContext["filePreviews"]["issue"]>[0] {
  if (locator.kind === "absolute") {
    return {
      absolutePath: locator.absolutePath,
      mime: locator.mime,
      revision: locator.revision,
    };
  }
  return {
    gitRoot: locator.gitRoot,
    mime: locator.mime,
    oid: locator.oid,
    revision: locator.revision,
  };
}
