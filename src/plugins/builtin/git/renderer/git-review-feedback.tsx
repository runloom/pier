import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewFailure } from "@shared/contracts/git-review.ts";
import { useEffect, useRef } from "react";
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
 * 内容区没有可展示正文时的错误主体。
 * 技术细节走 Details → dialogs.alert（符合操作反馈规范）；短失败不强制弹窗。
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

/**
 * 已有正文时只负责把刷新/渲染失败投递到 toast，不参与正文布局。
 * 单文件失败由对应 diff 项承载；首次加载完全失败则由 ReviewFailureEmpty 承载。
 */
export function ReviewFeedback({
  context,
  enabled = true,
  failures,
  indexFailure = null,
  indexFailureTitle,
  runtimeError = null,
  onRetryFailure,
  onRetryIndex,
  onRetryRender,
}: {
  readonly context: RendererPluginContext;
  readonly enabled?: boolean;
  readonly failures: readonly ReviewFailedResource[];
  readonly hasHiddenFailures?: boolean;
  readonly indexFailure?: GitReviewFailure | null;
  readonly indexFailureTitle?: string;
  readonly onRetryFailure?: (entryKey: string) => void;
  readonly onRetryIndex?: () => void;
  readonly onRetryRender?: () => void;
  readonly runtimeError?: Error | null;
  readonly staleRetainedCount?: number;
}): React.JSX.Element | null {
  const documentFailureCycleNotifiedRef = useRef(false);
  const latestDocumentFailuresRef = useRef(failures);
  const latestRetryFailureRef = useRef(onRetryFailure);
  const lastIndexFailureRef = useRef<string | null>(null);
  const lastRuntimeErrorRef = useRef<string | null>(null);
  latestDocumentFailuresRef.current = failures;
  latestRetryFailureRef.current = onRetryFailure;
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

  useEffect(() => {
    if (!indexFailure) {
      lastIndexFailureRef.current = null;
      return;
    }
    if (!enabled) {
      return;
    }
    const indexFailureMessage =
      indexFailure.message ?? gitReviewFailureMessage(context, indexFailure);
    const signature = `${indexFailure.reason}\u0000${indexFailureMessage}`;
    if (lastIndexFailureRef.current === signature) {
      return;
    }
    lastIndexFailureRef.current = signature;
    context.notifications.error(displayedIndexFailureTitle, {
      action: onRetryIndex
        ? {
            label: pluginText(context, "reviewRetry", "Retry"),
            onClick: onRetryIndex,
          }
        : {
            label: pluginText(context, "reviewDetails", "Details"),
            onClick: () => {
              context.dialogs
                .alert({
                  body: indexFailureMessage,
                  title: displayedIndexFailureTitle,
                })
                .catch(() => undefined);
            },
          },
    });
  }, [
    context,
    displayedIndexFailureTitle,
    enabled,
    indexFailure,
    onRetryIndex,
  ]);

  useEffect(() => {
    if (failures.length === 0) {
      documentFailureCycleNotifiedRef.current = false;
      return;
    }
    if (!enabled || documentFailureCycleNotifiedRef.current) {
      return;
    }
    documentFailureCycleNotifiedRef.current = true;
    const retryableFailures = onRetryFailure
      ? failures.filter(({ failure }) => failure.retryable)
      : [];
    const title = pluginText(
      context,
      "reviewAdditionalIssues",
      "Additional changes could not be displayed."
    );
    context.notifications.error(title, {
      action:
        retryableFailures.length > 0
          ? {
              label: pluginText(context, "reviewRetry", "Retry"),
              onClick: () => {
                for (const {
                  entry,
                  failure,
                } of latestDocumentFailuresRef.current) {
                  if (failure.retryable) {
                    latestRetryFailureRef.current?.(entry.entryKey);
                  }
                }
              },
            }
          : {
              label: pluginText(context, "reviewDetails", "Details"),
              onClick: () => {
                context.dialogs
                  .alert({
                    body: latestDocumentFailuresRef.current
                      .map(
                        ({ entry, failure }) =>
                          `${entry.path}\n${failure.message}`
                      )
                      .join("\n\n"),
                    title,
                  })
                  .catch(() => undefined);
              },
            },
    });
  }, [context, enabled, failures, onRetryFailure]);

  useEffect(() => {
    if (!runtimeError) {
      lastRuntimeErrorRef.current = null;
      return;
    }
    if (!enabled) {
      return;
    }
    const signature = `${runtimeError.name}\u0000${runtimeError.message}`;
    if (lastRuntimeErrorRef.current === signature) {
      return;
    }
    lastRuntimeErrorRef.current = signature;
    context.notifications.error(
      renderFailureTitle,
      onRetryRender
        ? {
            action: {
              label: pluginText(context, "reviewRetry", "Retry"),
              onClick: onRetryRender,
            },
          }
        : undefined
    );
  }, [context, enabled, onRetryRender, renderFailureTitle, runtimeError]);

  return null;
}
