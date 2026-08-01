import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewPresentation,
  PierDiffViewRenderWindow,
  PierHunkActionEvent,
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
import { useGitReviewCodeMutations } from "../hooks/use-code-mutations.ts";
import { pluginText } from "../plugin-text.ts";
import { usePluginLanguage } from "../use-plugin-language.ts";
import { ReviewErrorEmpty, ReviewLoading } from "./feedback.tsx";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
} from "./reading-surface.ts";

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
    (props: {
      appearance: {
        codeFontFamily: string;
        codeFontSize: string;
        codeTheme: string;
        colorMode: "dark" | "light";
      };
      items: readonly PierDiffViewItem[];
      labels: {
        collapseDiff: string;
        discardChanges: string;
        expandDiff: string;
        revertHunk?: string;
        stageChanges: string;
        stageHunk?: string;
        stageRemainingHunk?: string;
        unstageChanges: string;
        unstageHunk?: string;
      };
      onDiscardFile?: (itemId: string) => void;
      onError: (error: Error) => void;
      onHunkAction?: (event: PierHunkActionEvent) => void;
      onItemError?: (id: string, error: Error | null) => void;
      onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
      onScroll: () => void;
      onToggleStage?: (itemId: string) => void;
      presentation?: PierDiffViewPresentation;
      ref: (handle: PierDiffViewHandle | null) => void;
      getSuppressMembershipScrollRestore?: () => boolean;
      suppressMembershipScrollRestore?: boolean;
    }) => React.JSX.Element | null
  > | null = null;
  const getSharedView = () => {
    if (!sharedView) {
      sharedView = lazy(load);
    }
    return sharedView;
  };
  return function ReviewCodeView({
    appearance,
    context,
    contextId,
    diffRef,
    entries,
    gitRootPath,
    items,
    mutationAuthorityBlocked,
    onFeedbackChange,
    onAcquireMutationAuthority,
    onItemError,
    onMutationCommitted,
    onRenderWindowChange,
    onScroll,
    presentation,
    revisionBySectionId,
    getSuppressMembershipScrollRestore,
    suppressMembershipScrollRestore = false,
  }: {
    readonly appearance: RendererPluginAppearance;
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
    readonly onItemError?: (id: string, error: Error | null) => void;
    readonly onMutationCommitted?: (
      result: GitReviewMutationOk | null,
      transition?: GitReviewMutationTransition
    ) => Promise<void>;
    readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
    readonly onScroll: () => void;
    readonly presentation?: PierDiffViewPresentation;
    readonly revisionBySectionId: ReadonlyMap<string, string>;
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

    const setDiffHandle = useCallback(
      (handle: PierDiffViewHandle | null) => {
        handleRef.current = handle;
        diffRef(handle);
      },
      [diffRef]
    );

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
        expandDiff: pluginText(context, "reviewExpandDiff", "Expand diff"),
        openFile: pluginText(context, "reviewTreeOpenFile", "Open File"),
        revertHunk: pluginText(context, "reviewHunkRevert", "Revert"),
        stageChanges: pluginText(context, "reviewHeaderStage", "Stage"),
        stageHunk: pluginText(context, "reviewHunkStage", "Stage"),
        stageRemainingHunk: pluginText(
          context,
          "reviewHunkStageRemaining",
          "Stage Remaining Changes"
        ),
        unstageChanges: pluginText(context, "reviewHeaderUnstage", "Unstage"),
        unstageHunk: pluginText(context, "reviewHunkUnstage", "Unstage"),
      }),
      [context, language]
    );

    return (
      <fieldset
        aria-busy={mutationAuthorityBlocked}
        className="m-0 h-full min-h-0 min-w-0 border-0 p-0"
        data-git-review-mutation-blocked={mutationAuthorityBlocked}
        disabled={mutationAuthorityBlocked}
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
                  codeTheme: appearance.codeTheme,
                  colorMode: appearance.theme,
                }}
                items={displayItems}
                labels={diffLabels}
                onError={setRuntimeError}
                {...(onItemError === undefined ? {} : { onItemError })}
                {...(gitRootPath ? { onOpenFile } : {})}
                onRenderWindowChange={onRenderWindowChange}
                onScroll={onScroll}
                {...(canMutate
                  ? {
                      onDiscardFile,
                      onHunkAction,
                      onToggleStage,
                    }
                  : {})}
                {...(presentation === undefined ? {} : { presentation })}
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
