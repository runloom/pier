import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { pluginText } from "./git-plugin-text.ts";
import { ReviewLoading } from "./git-review-feedback.tsx";

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
  return function ReviewCodeView({
    appearance,
    context,
    diffRef,
    items,
    onFeedbackChange,
    onItemError,
    onRenderWindowChange,
    onScroll,
  }: {
    readonly appearance: RendererPluginAppearance;
    readonly context: RendererPluginContext;
    readonly diffRef: (handle: PierDiffViewHandle | null) => void;
    readonly items: readonly PierDiffViewItem[];
    readonly onFeedbackChange: (feedback: ReviewRenderFeedback | null) => void;
    readonly onItemError?: (id: string, error: Error | null) => void;
    readonly onRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
    readonly onScroll: () => void;
  }): React.JSX.Element {
    const [runtimeError, setRuntimeError] = useState<Error | null>(null);
    const [attempt, setAttempt] = useState(() => ({
      id: 0,
      View: lazy(load),
    }));
    const LazyPierDiffView = attempt.View;
    const retry = useCallback(() => {
      setRuntimeError(null);
      setAttempt((current) => ({
        id: current.id + 1,
        View: lazy(load),
      }));
    }, []);
    useEffect(() => {
      onFeedbackChange(
        runtimeError === null ? null : { error: runtimeError, retry }
      );
      return () => onFeedbackChange(null);
    }, [onFeedbackChange, retry, runtimeError]);
    return (
      <div className="h-full min-h-0">
        {runtimeError ? null : (
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
                items={items}
                labels={{
                  collapseDiff: pluginText(
                    context,
                    "reviewCollapseDiff",
                    "Collapse diff"
                  ),
                  expandDiff: pluginText(
                    context,
                    "reviewExpandDiff",
                    "Expand diff"
                  ),
                }}
                onError={setRuntimeError}
                {...(onItemError === undefined ? {} : { onItemError })}
                onRenderWindowChange={onRenderWindowChange}
                onScroll={onScroll}
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
