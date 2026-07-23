import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewPresentation,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import {
  Component,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { confirmDialog, notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";
import { ReviewErrorEmpty, ReviewLoading } from "./git-review-feedback.tsx";
import { usePluginLanguage } from "./use-plugin-language.ts";

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

const loadPierDiffView = () =>
  import("@pier/ui/diff-view.tsx").then((module) => ({
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
        baseFontSize: string;
        codeFontFamily: string;
        codeTheme: string;
        colorMode: "dark" | "light";
      };
      items: readonly PierDiffViewItem[];
      labels: {
        collapseDiff: string;
        discardChanges: string;
        expandDiff: string;
        stageChanges: string;
        unstageChanges: string;
      };
      onDiscardFile?: (itemId: string) => void;
      onError: (error: Error) => void;
      onItemError?: (id: string, error: Error | null) => void;
      onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
      onScroll: () => void;
      onToggleStage?: (itemId: string) => void;
      presentation?: PierDiffViewPresentation;
      ref: (handle: PierDiffViewHandle | null) => void;
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
    onFeedbackChange,
    onItemError,
    onRenderWindowChange,
    onScroll,
    presentation,
  }: {
    readonly appearance: RendererPluginAppearance;
    readonly context: RendererPluginContext;
    readonly contextId: string;
    readonly diffRef: (handle: PierDiffViewHandle | null) => void;
    /** Uncommitted index entries for header stage toggle; omit for read-only scopes. */
    readonly entries?: readonly GitReviewIndexEntry[];
    readonly gitRootPath?: string;
    readonly items: readonly PierDiffViewItem[];
    readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
    readonly onItemError?: (id: string, error: Error | null) => void;
    readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
    readonly onScroll: () => void;
    readonly presentation?: PierDiffViewPresentation;
  }): React.JSX.Element {
    const language = usePluginLanguage();
    const [runtimeError, setRuntimeError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(() => ({
      id: 0,
      View: getSharedView(),
    }));
    const [busySectionKeys, setBusySectionKeys] = useState(
      () => new Set<string>()
    );
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

    const displayItems = useMemo(() => {
      if (busySectionKeys.size === 0) {
        return items;
      }
      return items.map((item) => {
        if (!(item.stageControl && busySectionKeys.has(item.id))) {
          return item;
        }
        return {
          ...item,
          stageControl: { ...item.stageControl, busy: true },
        };
      });
    }, [busySectionKeys, items]);

    const resolveSlot = useCallback(
      (itemId: string) => {
        if (!entries) {
          return null;
        }
        for (const entry of entries) {
          const slot = entry.renderSlots.find(
            (candidate) => candidate.sectionKey === itemId
          );
          if (slot) {
            return { entry, slot };
          }
        }
        return null;
      },
      [entries]
    );

    const withBusy = useCallback((itemId: string, run: Promise<unknown>) => {
      setBusySectionKeys((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
      return run.finally(() => {
        setBusySectionKeys((prev) => {
          if (!prev.has(itemId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      });
    }, []);

    const onToggleStage = useCallback(
      (itemId: string) => {
        if (!(entries && gitRootPath) || busySectionKeys.has(itemId)) {
          return;
        }
        const item = items.find((candidate) => candidate.id === itemId);
        const stageState = item?.stageControl?.state;
        if (!stageState) {
          return;
        }
        const resolved = resolveSlot(itemId);
        if (!resolved) {
          return;
        }
        const { entry, slot } = resolved;
        const paths = [
          slot.targetPath,
          ...entry.oldPaths.filter((path) => path !== slot.targetPath),
        ];
        withBusy(
          itemId,
          (async () => {
            try {
              const ok =
                stageState === "staged"
                  ? await context.git.unstage(gitRootPath, paths)
                  : await context.git.stage(gitRootPath, paths);
              if (!ok) {
                notifyError(
                  context,
                  stageState === "staged"
                    ? pluginText(
                        context,
                        "reviewTreeUnstageFailed",
                        "Unable to Unstage"
                      )
                    : pluginText(
                        context,
                        "reviewTreeStageFailed",
                        "Unable to Stage"
                      )
                );
              }
            } catch (error) {
              notifyError(
                context,
                stageState === "staged"
                  ? pluginText(
                      context,
                      "reviewTreeUnstageFailed",
                      "Unable to Unstage"
                    )
                  : pluginText(
                      context,
                      "reviewTreeStageFailed",
                      "Unable to Stage"
                    ),
                error
              );
            }
          })()
        ).catch(() => undefined);
      },
      [
        busySectionKeys,
        context,
        entries,
        gitRootPath,
        items,
        resolveSlot,
        withBusy,
      ]
    );

    const onDiscardFile = useCallback(
      (itemId: string) => {
        if (!(entries && gitRootPath) || busySectionKeys.has(itemId)) {
          return;
        }
        const item = items.find((candidate) => candidate.id === itemId);
        if (
          item?.stageControl?.state !== "unstaged" ||
          item.stageControl.canDiscard !== true
        ) {
          return;
        }
        const resolved = resolveSlot(itemId);
        if (!resolved) {
          return;
        }
        const path = resolved.slot.targetPath;
        const slash = path.lastIndexOf("/");
        const name = slash >= 0 ? path.slice(slash + 1) : path;
        (async () => {
          const title = pluginText(context, "reviewHeaderRestore", "Restore");
          const confirmed = await confirmDialog(
            context,
            title,
            pluginText(
              context,
              "reviewTreeDiscardConfirm",
              "Restore changes in {{name}}?\nThis cannot be undone.",
              { name }
            ),
            pluginText(context, "reviewHeaderRestore", "Restore"),
            undefined,
            { intent: "destructive" }
          );
          if (!confirmed) {
            return;
          }
          await withBusy(
            itemId,
            (async () => {
              try {
                const ok = await context.git.discardChanges(gitRootPath, [
                  path,
                ]);
                if (!ok) {
                  notifyError(
                    context,
                    pluginText(
                      context,
                      "reviewTreeDiscardFailed",
                      "Unable to Restore"
                    )
                  );
                }
              } catch (error) {
                notifyError(
                  context,
                  pluginText(
                    context,
                    "reviewTreeDiscardFailed",
                    "Unable to Restore"
                  ),
                  error
                );
              }
            })()
          );
        })().catch(() => undefined);
      },
      [
        busySectionKeys,
        context,
        entries,
        gitRootPath,
        items,
        resolveSlot,
        withBusy,
      ]
    );

    const canMutate = Boolean(entries && gitRootPath);
    const onOpenFile = useCallback(
      (itemId: string) => {
        if (!gitRootPath) {
          return;
        }
        const item = items.find((entry) => entry.id === itemId);
        const path = item?.fileDisplay?.path;
        if (!path) {
          return;
        }
        const opened = context.files.openInEditor({
          context: {
            contextId,
            gitRoot: gitRootPath,
            projectRootPath: gitRootPath,
            source: "panel",
            updatedAt: Date.now(),
          },
          path,
          root: gitRootPath,
          title: basename(path),
        });
        if (!opened) {
          context.notifications.error(
            pluginText(
              context,
              "reviewTreeOpenFileFailed",
              "Unable to open file"
            )
          );
        }
      },
      [context, contextId, gitRootPath, items]
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
        discardChanges: pluginText(context, "reviewHeaderRestore", "Restore"),
        expandDiff: pluginText(context, "reviewExpandDiff", "Expand diff"),
        openFile: pluginText(context, "reviewTreeOpenFile", "Open File"),
        stageChanges: pluginText(context, "reviewHeaderStage", "Stage"),
        unstageChanges: pluginText(context, "reviewHeaderUnstage", "Unstage"),
      }),
      [context, language]
    );

    return (
      <div className="h-full min-h-0">
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
                  baseFontSize: appearance.typography.baseFontSize,
                  codeFontFamily: appearance.typography.codeFontFamily,
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
                {...(canMutate ? { onDiscardFile, onToggleStage } : {})}
                {...(presentation === undefined ? {} : { presentation })}
                ref={diffRef}
              />
            </Suspense>
          </ReviewCodeViewLoadBoundary>
        )}
      </div>
    );
  };
}

export const ReviewCodeView = createReviewCodeView(loadPierDiffView);
