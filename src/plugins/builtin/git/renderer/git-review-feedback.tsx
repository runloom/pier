import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewFailure } from "@shared/contracts/git-review.ts";
import { Ellipsis, RefreshCw } from "lucide-react";
import { pluginText } from "./git-plugin-text.ts";
import type { ReviewFailedResource } from "./git-review-document-generation.ts";
import { gitReviewFailureMessage } from "./git-review-message.ts";

export function ReviewLoading({
  context,
}: {
  readonly context: RendererPluginContext;
}): React.JSX.Element {
  return (
    <div
      aria-label={pluginText(context, "reviewLoading", "Loading changes")}
      className="flex h-full flex-col gap-2 p-3"
      role="status"
    >
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/**
 * 内容区没有可展示正文时的错误主体状态。基于 kit 的 ErrorEmpty,
 * 补上插件文案与 Details 对话框接线。
 */
export function ReviewErrorEmpty({
  context,
  description,
  detail,
  onRetry,
  title,
}: {
  readonly context: RendererPluginContext;
  readonly description?: string | undefined;
  readonly detail?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly title: string;
}): React.JSX.Element {
  const hasDetail = (detail?.trim().length ?? 0) > 0;
  return (
    <ErrorEmpty
      {...(description === undefined ? {} : { description })}
      {...(hasDetail
        ? {
            detailAction: {
              label: pluginText(context, "reviewDetails", "Details"),
              onClick: () => {
                context.dialogs
                  .alert({
                    body: detail ?? "",
                    title,
                  })
                  .catch(() => undefined);
              },
            },
          }
        : {})}
      {...(onRetry
        ? {
            retryAction: {
              label: pluginText(context, "reviewRetry", "Retry"),
              onClick: onRetry,
            },
          }
        : {})}
      title={title}
    />
  );
}

/** index/文档失败的 Empty 主体:描述用本地化摘要,原始诊断进 Details。 */
export function ReviewFailureEmpty({
  context,
  failure,
  onRetry,
  title,
}: {
  readonly context: RendererPluginContext;
  readonly failure: GitReviewFailure;
  readonly onRetry?: (() => void) | undefined;
  readonly title: string;
}): React.JSX.Element {
  return (
    <ReviewErrorEmpty
      context={context}
      description={gitReviewFailureMessage(context, failure)}
      detail={failure.message}
      onRetry={failure.retryable ? onRetry : undefined}
      title={title}
    />
  );
}

function FeedbackActions({
  context,
  detail,
  onRetry,
  title,
}: {
  readonly context: RendererPluginContext;
  readonly detail: string | null;
  readonly onRetry: (() => void) | undefined;
  readonly title: string;
}): React.JSX.Element | null {
  const hasDetail = (detail?.trim().length ?? 0) > 0;
  if (!(hasDetail || onRetry)) {
    return null;
  }
  return (
    <AlertAction className="flex gap-1">
      {hasDetail ? (
        <Button
          aria-label={pluginText(context, "reviewDetails", "Details")}
          onClick={() => {
            context.dialogs
              .alert({
                body: detail ?? "",
                title,
              })
              .catch(() => undefined);
          }}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          <Ellipsis data-icon />
        </Button>
      ) : null}
      {onRetry ? (
        <Button
          aria-label={pluginText(context, "reviewRetry", "Retry")}
          onClick={onRetry}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          <RefreshCw data-icon />
        </Button>
      ) : null}
    </AlertAction>
  );
}

function ReviewFailureActions({
  context,
  failure,
  onRetry,
  title,
}: {
  readonly context: RendererPluginContext;
  readonly failure: GitReviewFailure;
  readonly onRetry: (() => void) | undefined;
  readonly title: string;
}): React.JSX.Element | null {
  return (
    <FeedbackActions
      context={context}
      detail={failure.message}
      onRetry={failure.retryable ? onRetry : undefined}
      title={title}
    />
  );
}

export function ReviewFeedback({
  context,
  failures,
  hasHiddenFailures = false,
  indexFailure = null,
  indexFailureTitle,
  navigationError,
  onRetryNavigation,
  runtimeError = null,
  onRetryIndex,
  onRetryFailure,
  onRetryRender,
  staleRetainedCount = 0,
}: {
  readonly context: RendererPluginContext;
  readonly failures: readonly ReviewFailedResource[];
  readonly hasHiddenFailures?: boolean;
  readonly indexFailure?: GitReviewFailure | null;
  readonly indexFailureTitle?: string;
  readonly navigationError?: Error | null;
  readonly onRetryFailure?: (entryKey: string) => void;
  readonly onRetryIndex?: () => void;
  readonly onRetryNavigation?: () => void;
  readonly onRetryRender?: () => void;
  /** 仅用于「正文仍可见但最新更新被拒」的暂态横条;全空白错误走 Empty。 */
  readonly runtimeError?: Error | null;
  readonly staleRetainedCount?: number;
}): React.JSX.Element | null {
  if (
    !(
      runtimeError ||
      navigationError ||
      indexFailure ||
      failures.length > 0 ||
      hasHiddenFailures ||
      staleRetainedCount > 0
    )
  ) {
    return null;
  }
  const refreshFailureTitle = pluginText(
    context,
    "reviewRefreshFailed",
    "Failed to refresh changes"
  );
  const displayedIndexFailureTitle = indexFailureTitle ?? refreshFailureTitle;
  const renderFailureTitle = pluginText(
    context,
    "reviewRenderFailed",
    "Failed to render diff"
  );
  const navigationFailureTitle = pluginText(
    context,
    "reviewNavigationFailed",
    "Failed to navigate to file"
  );
  return (
    <ScrollArea className="max-h-[40%] shrink-0">
      <div className="flex flex-col gap-2 p-2">
        {indexFailure ? (
          <Alert variant="destructive">
            <AlertTitle>{displayedIndexFailureTitle}</AlertTitle>
            <AlertDescription>
              {gitReviewFailureMessage(context, indexFailure)}
            </AlertDescription>
            <ReviewFailureActions
              context={context}
              failure={indexFailure}
              onRetry={onRetryIndex}
              title={displayedIndexFailureTitle}
            />
          </Alert>
        ) : null}
        {runtimeError && onRetryRender ? (
          <Alert variant="destructive">
            <AlertTitle>{renderFailureTitle}</AlertTitle>
            <FeedbackActions
              context={context}
              detail={runtimeError.message}
              onRetry={onRetryRender}
              title={renderFailureTitle}
            />
          </Alert>
        ) : null}
        {navigationError && onRetryNavigation ? (
          <Alert variant="destructive">
            <AlertTitle>{navigationFailureTitle}</AlertTitle>
            <FeedbackActions
              context={context}
              detail={navigationError.message}
              onRetry={onRetryNavigation}
              title={navigationFailureTitle}
            />
          </Alert>
        ) : null}
        {failures.map((resource) => (
          <Alert key={resource.entry.entryKey} variant="destructive">
            <AlertTitle className="min-w-0 break-all font-mono">
              {resource.entry.path}
            </AlertTitle>
            <AlertDescription>
              {gitReviewFailureMessage(context, resource.failure)}
            </AlertDescription>
            <ReviewFailureActions
              context={context}
              failure={resource.failure}
              onRetry={
                onRetryFailure
                  ? () => onRetryFailure(resource.entry.entryKey)
                  : undefined
              }
              title={resource.entry.path}
            />
          </Alert>
        ))}
        {hasHiddenFailures ? (
          <Alert>
            <AlertTitle>
              {pluginText(
                context,
                "reviewAdditionalIssues",
                "Additional changes could not be displayed."
              )}
            </AlertTitle>
          </Alert>
        ) : null}
        {staleRetainedCount > 0 ? (
          <Alert>
            <AlertTitle>
              {pluginText(
                context,
                "reviewRefreshStale",
                "Some files changed again while refreshing. Their previous diff remains visible until the next Git update."
              )}
            </AlertTitle>
          </Alert>
        ) : null}
      </div>
    </ScrollArea>
  );
}
