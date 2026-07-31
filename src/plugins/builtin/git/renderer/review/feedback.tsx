import {
  PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX,
  PIER_DIFF_ESTIMATE_SKELETON_BAR_WIDTHS,
  PIER_DIFF_ESTIMATE_SKELETON_GAP_PX,
  PIER_DIFF_ESTIMATE_SKELETON_PAD_LEFT_PX,
  PIER_DIFF_ESTIMATE_SKELETON_PAD_RIGHT_PX,
  PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX,
  PIER_TREE_SKELETON_BAR_HEIGHT_PX,
  PIER_TREE_SKELETON_ICON_PX,
  PIER_TREE_SKELETON_INDENT_PX,
  PIER_TREE_SKELETON_PAD_X_PX,
  PIER_TREE_SKELETON_ROW_HEIGHT_PX,
} from "@pier/ui/diff-view/estimate-skeleton.ts";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewFailureReason,
} from "@shared/contracts/git/review.ts";
import { useEffect, useRef } from "react";
import { pluginText } from "../plugin-text.ts";
import type { ReviewFailedResource } from "./document/generation.ts";
import { gitReviewFailureMessage } from "./message.ts";

/**
 * stage / watch 整代刷新时 document 读常撞到的竞态原因。
 * soft-retain 仍展示旧正文，且下一次 index 会再拉——全局 error toast 是噪声。
 * （金标准：stage 成功路径零 toast.error）
 */
const TRANSIENT_REVIEW_FAILURE_REASONS = new Set<GitReviewFailureReason>([
  "aborted",
  "busy",
  "changeNotFound",
  "duplicateOperation",
  "staleRevision",
]);

function isTransientReviewFailure(resource: ReviewFailedResource): boolean {
  return TRANSIENT_REVIEW_FAILURE_REASONS.has(resource.failure.reason);
}

function reviewFailureBasename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function documentFailureToastTitle(
  context: RendererPluginContext,
  failures: readonly ReviewFailedResource[]
): string {
  if (failures.length === 1) {
    const path = failures[0]?.entry.path ?? "";
    return pluginText(
      context,
      "reviewAdditionalIssuesSingle",
      "Could not display {{name}}.",
      { name: reviewFailureBasename(path) }
    );
  }
  return pluginText(
    context,
    "reviewAdditionalIssuesCount",
    "{{count}} files could not be displayed.",
    { count: failures.length }
  );
}

/** soft-retain 永久失败：旧正文仍在，语气中性（非 stale 竞态专属文案）。 */
function softRetainedRefreshToastTitle(context: RendererPluginContext): string {
  return pluginText(
    context,
    "reviewRefreshSoftRetained",
    "Couldn't refresh this diff. The previous view is still shown."
  );
}

type DocumentFailureToastMode = "hard" | "soft";

/**
 * 正文区骨架条：内容区底上用 muted 可见。
 * 侧栏禁止此 class——sidebar === muted，会「有骨架看不见」。
 */
const CONTENT_SKELETON_BAR = "rounded-sm bg-muted";

/**
 * 侧栏树骨架条：sidebar 底色等于 muted，必须用前景淡色 + pulse。
 */
const TREE_SKELETON_BAR =
  "rounded-sm bg-sidebar-foreground/12 dark:bg-sidebar-foreground/14";

/**
 * 正文加载骨架：与 estimate 槽同几何（constants 单源）。
 */
export function ReviewLoading({
  context,
}: {
  readonly context: RendererPluginContext;
}): React.JSX.Element {
  return (
    <div
      aria-label={pluginText(context, "reviewLoading", "Loading changes")}
      className="flex h-full flex-col"
      data-testid="git-review-document-loading"
      role="status"
      style={{
        gap: PIER_DIFF_ESTIMATE_SKELETON_GAP_PX,
        paddingBottom: PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX,
        paddingLeft: PIER_DIFF_ESTIMATE_SKELETON_PAD_LEFT_PX,
        paddingRight: PIER_DIFF_ESTIMATE_SKELETON_PAD_RIGHT_PX,
        paddingTop: PIER_DIFF_ESTIMATE_SKELETON_PAD_Y_PX,
      }}
    >
      <Skeleton className={cn(CONTENT_SKELETON_BAR, "mb-0.5 h-7 w-full")} />
      {PIER_DIFF_ESTIMATE_SKELETON_BAR_WIDTHS.map((width) => (
        <Skeleton
          className={CONTENT_SKELETON_BAR}
          key={width}
          style={{
            height: PIER_DIFF_ESTIMATE_SKELETON_BAR_HEIGHT_PX,
            width,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 侧栏目录树加载骨架。
 *
 * 几何对齐真实树：pad 4 / 行 28 / 缩进 12 / 图标 14。
 * 颜色：sidebar-foreground 淡色（禁止 bg-muted）。
 */
export function ReviewTreeLoading({
  context,
}: {
  readonly context: RendererPluginContext;
}): React.JSX.Element {
  const rows = [
    { indent: 0, width: "58%" },
    { indent: 1, width: "72%" },
    { indent: 1, width: "64%" },
    { indent: 2, width: "80%" },
    { indent: 2, width: "55%" },
    { indent: 1, width: "68%" },
    { indent: 2, width: "74%" },
    { indent: 2, width: "50%" },
    { indent: 0, width: "48%" },
    { indent: 1, width: "70%" },
    { indent: 2, width: "62%" },
    { indent: 1, width: "76%" },
  ] as const;
  return (
    <div
      aria-busy="true"
      aria-label={pluginText(
        context,
        "reviewTreeLoading",
        "Loading changed files"
      )}
      className="flex min-h-0 w-full flex-1 flex-col py-1"
      data-testid="git-review-tree-loading"
      role="status"
      style={{
        paddingLeft: PIER_TREE_SKELETON_PAD_X_PX,
        paddingRight: PIER_TREE_SKELETON_PAD_X_PX,
      }}
    >
      {rows.map((row, index) => (
        <div
          className="flex shrink-0 items-center gap-1.5"
          key={`tree-skel-${String(index)}`}
          style={{
            height: PIER_TREE_SKELETON_ROW_HEIGHT_PX,
            paddingLeft: row.indent * PIER_TREE_SKELETON_INDENT_PX,
          }}
        >
          <Skeleton
            className={cn(TREE_SKELETON_BAR, "shrink-0")}
            style={{
              height: PIER_TREE_SKELETON_ICON_PX,
              width: PIER_TREE_SKELETON_ICON_PX,
            }}
          />
          <Skeleton
            className={cn(TREE_SKELETON_BAR, "min-w-0")}
            style={{
              height: PIER_TREE_SKELETON_BAR_HEIGHT_PX,
              width: row.width,
            }}
          />
        </div>
      ))}
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
      {...(failure.retryable && onRetry ? { onRetry } : {})}
      title={title}
    />
  );
}

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
  softRetainedOnly = false,
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
  readonly softRetainedOnly?: boolean;
  readonly staleRetainedCount?: number;
}): React.JSX.Element | null {
  /**
   * 失败波 mode：null 未通知 / soft info / hard error。
   * 同 mode 内只通知一次；soft→hard 可升级再通知；失败清空后重置。
   */
  const lastDocumentFailureToastModeRef =
    useRef<DocumentFailureToastMode | null>(null);
  const latestDocumentFailuresRef = useRef(failures);
  const latestRetryFailureRef = useRef(onRetryFailure);
  const lastNotifiedToastEntryKeysRef = useRef<ReadonlySet<string>>(new Set());
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
      lastDocumentFailureToastModeRef.current = null;
      lastNotifiedToastEntryKeysRef.current = new Set();
      return;
    }
    // stage/watch 竞态（staleRevision 等）会自愈或由下一次 index 再拉；
    // 全局 error toast 违反金标准「stage 成功路径零 toast」，一律静默。
    const toastFailures = failures.filter(
      (resource) => !isTransientReviewFailure(resource)
    );
    if (toastFailures.length === 0) {
      lastDocumentFailureToastModeRef.current = null;
      lastNotifiedToastEntryKeysRef.current = new Set();
      return;
    }
    if (!enabled) {
      return;
    }
    const mode: DocumentFailureToastMode = softRetainedOnly ? "soft" : "hard";
    const previousMode = lastDocumentFailureToastModeRef.current;
    // 同 mode 内只通知一次；允许 soft → hard 升级再发 error。
    if (previousMode === mode || (previousMode === "hard" && mode === "soft")) {
      return;
    }
    lastDocumentFailureToastModeRef.current = mode;
    const toastEntryKeys = new Set(
      toastFailures.map((resource) => resource.entry.entryKey)
    );
    lastNotifiedToastEntryKeysRef.current = toastEntryKeys;
    const retryableFailures = onRetryFailure
      ? toastFailures.filter(({ failure }) => failure.retryable)
      : [];
    // soft-retain：旧 diff 仍可见，用中性保留文案，不用「无法显示」。
    const title =
      mode === "soft"
        ? softRetainedRefreshToastTitle(context)
        : documentFailureToastTitle(context, toastFailures);
    const notify =
      mode === "soft"
        ? context.notifications.info.bind(context.notifications)
        : context.notifications.error.bind(context.notifications);
    notify(title, {
      action:
        retryableFailures.length > 0
          ? {
              label: pluginText(context, "reviewRetry", "Retry"),
              onClick: () => {
                const keys = lastNotifiedToastEntryKeysRef.current;
                for (const {
                  entry,
                  failure,
                } of latestDocumentFailuresRef.current) {
                  if (failure.retryable && keys.has(entry.entryKey)) {
                    latestRetryFailureRef.current?.(entry.entryKey);
                  }
                }
              },
            }
          : {
              label: pluginText(context, "reviewDetails", "Details"),
              onClick: () => {
                const keys = lastNotifiedToastEntryKeysRef.current;
                const body = latestDocumentFailuresRef.current
                  .filter((resource) => keys.has(resource.entry.entryKey))
                  .map(
                    ({ entry, failure }) => `${entry.path}\n${failure.message}`
                  )
                  .join("\n\n");
                context.dialogs
                  .alert({
                    body,
                    title,
                  })
                  .catch(() => undefined);
              },
            },
    });
  }, [context, enabled, failures, onRetryFailure, softRetainedOnly]);

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
