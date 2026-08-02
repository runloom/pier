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
import type { GitReviewFailure } from "@shared/contracts/git/review.ts";
import { pluginText } from "../plugin-text.ts";
import type { ReviewFailedResource } from "./document/generation.ts";
import { gitReviewFailureMessage } from "./message.ts";

/**
 * Review 失败面 UI 原语 + 反馈门面。
 *
 * 持续更新契约（2026-08-02）：背景路径（watch / 自动 materialize / parse /
 * apply / soft-retain 刷新 / 无 userIntent 的 index 刷新）不得抬升全局
 * 错误或信息提示。失败进 last-good / 行内 error 槽 / 面板 Empty；
 * 全局提示仅留给 mutation 等用户意图路径（由调用点直接反馈，不经本门面
 * 对 failures/runtimeError 抬升）。
 *
 * @see docs/superpowers/specs/2026-08-02-git-review-live-update-failure-contract-design.md
 */

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

/**
 * 反馈门面：保留调用面 API，背景路径 **不** 再抬全局提示。
 *
 * - `failures` / `softRetainedOnly`：行内 error 槽 / soft-retain 已由投影承担
 * - `runtimeError`：由 CodeView 面板内 Empty + Retry 承担（非全局提示）
 * - `indexFailure`：有 last-good 时静默；整页无内容时由面板 Empty 承担
 * - document error 槽行内 Retry：`onRetryFailure` 经 CodeView `onRetryItem` 接线（F3）
 * - 用户意图（stage/discard/手动刷新）失败：由 mutation 调用点直接反馈（F4）
 *
 * props 仍接收以便宿主接线稳定；本组件本体 no-op（F1 关 toast）。
 */
export function ReviewFeedback(_props: {
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
  return null;
}
