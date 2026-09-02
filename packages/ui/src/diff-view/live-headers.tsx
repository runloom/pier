import { RotateCcw } from "lucide-react";
import { Button } from "../button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip.tsx";
import { CollapseDiffButton, type PierDiffViewLabels } from "./collapse.tsx";
import {
  DriftCommentChip,
  type PierDriftCommentLabels,
} from "./gutter/gutter-comments.tsx";
import { isImageDiffCacheKey } from "./image-diff/file-diff.ts";
import { type DiffViewInputStore, useDiffViewInput } from "./input-store.ts";
import { fileDiffLineStats, type PierDiffCodeViewItem } from "./items.ts";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
} from "./presentation.ts";
import { DiffHeaderActions } from "./stage-button.tsx";
import { isUnresolvedConflictCacheKey } from "./unresolved-conflict/file-diff.ts";

export function LiveHeaderPrefix({
  inputStore,
  item,
  labels,
  onToggle,
  userCollapsed = false,
}: {
  readonly inputStore: DiffViewInputStore;
  readonly item: PierDiffCodeViewItem;
  readonly labels: PierDiffViewLabels;
  readonly onToggle: (item: PierDiffCodeViewItem) => void;
  /** 用户主动收起（含「折叠全部」），区别于 estimate 的技术默认折叠。 */
  readonly userCollapsed?: boolean;
}): React.JSX.Element {
  const input = useDiffViewInput(inputStore, item.id);
  const hydrating =
    input !== undefined && pierDiffItemPresentation(input) === "loading";
  // 用户已收起的槽位不按「懒加载中」呈现：正文是否到达与折叠态无关。
  // 否则大仓折叠全部后，每个 chevron 会随正文到达从半透明+展开方向
  // 逐个变实并转向——和暂存按钮逐个解锁是同一类问题。
  // 未被用户收起的 estimate 仍保留 loading 视觉：首屏全是 estimate 时
  // 若都画成 collapsed，会被误读成「列表被收起了」。
  const loading = hydrating && !userCollapsed;
  const emptyReady =
    !hydrating &&
    item.type === "diff" &&
    item.fileDiff.splitLineCount === 0 &&
    item.fileDiff.unifiedLineCount === 0;
  // empty：禁用 expand，并按 collapsed 呈现（对齐 DiffsHub disabled||collapsed）
  return (
    <CollapseDiffButton
      collapsed={emptyReady || item.collapsed === true}
      disabled={emptyReady}
      labels={labels}
      loading={loading}
      onToggle={() => onToggle(item)}
    />
  );
}

export function LiveHeaderMetadata({
  driftCommentLabels,
  inputStore,
  item,
  labels,
  onDiscardFile,
  onDriftCommentActivate,
  onRetryItem,
  onToggleStage,
}: {
  readonly driftCommentLabels?: PierDriftCommentLabels;
  readonly inputStore: DiffViewInputStore;
  readonly item: PierDiffCodeViewItem;
  readonly labels: PierDiffViewLabels;
  readonly onDiscardFile?: (itemId: string) => void;
  /** drift 评论 chip 点击（host 打开线程卡，仅传 threadId）。 */
  readonly onDriftCommentActivate?: (threadId: string) => void;
  /** document materialize 等 error 槽行内重试（F3 / 2026-08-02 契约） */
  readonly onRetryItem?: (itemId: string) => void;
  readonly onToggleStage?: (itemId: string) => void;
}): React.JSX.Element | null {
  const input = useDiffViewInput(inputStore, item.id);
  if (item.type !== "diff") {
    return null;
  }
  const loading =
    input !== undefined && pierDiffItemPresentation(input) === "loading";
  // 已解析 hunk 优先；estimate 用 index numstat 首屏齐刷（loading 时仍显示）
  const fromHunks =
    isImageDiffCacheKey(item.fileDiff.cacheKey) ||
    isUnresolvedConflictCacheKey(item.fileDiff.cacheKey)
      ? { additions: 0, deletions: 0 }
      : fileDiffLineStats(item.fileDiff);
  const fromIndex = input?.lineStats;
  const { additions, deletions } = shouldRenderDiffLineStats(fromHunks)
    ? fromHunks
    : (fromIndex ?? fromHunks);
  // estimate loading 仍展示 lineStats；仅无 stats 时隐藏
  const showStats = shouldRenderDiffLineStats({ additions, deletions });
  const stageControl = input?.stageControl;
  const showStage = stageControl != null && onToggleStage != null;
  const stateNotice = loading ? "" : (input?.stateNotice?.trim() ?? "");
  const showNotice = stateNotice.length > 0;
  const retryLabel = labels.retry?.trim() ?? "";
  const showRetry =
    input?.kind === "error" &&
    onRetryItem !== undefined &&
    retryLabel.length > 0;
  const driftComments = input?.driftComments;
  const showDrift =
    driftComments !== undefined &&
    driftComments.length > 0 &&
    driftCommentLabels !== undefined &&
    onDriftCommentActivate !== undefined;
  if (!(showStats || showStage || showNotice || showRetry || showDrift)) {
    return null;
  }
  const driftSlot =
    showDrift &&
    driftCommentLabels !== undefined &&
    onDriftCommentActivate !== undefined &&
    driftComments !== undefined ? (
      <span
        className="inline-flex shrink-0 items-center gap-0.5"
        data-slot="pier-diff-header-drift-comments"
      >
        {driftComments.map((thread) => (
          <DriftCommentChip
            key={thread.threadId}
            labels={driftCommentLabels}
            onActivate={() => onDriftCommentActivate(thread.threadId)}
            thread={thread}
          />
        ))}
      </span>
    ) : null;
  // One light-DOM root so the header-metadata slot can be width:100%.
  // Fragment would assign multiple nodes and break far-right actions.
  return (
    <span
      className="flex w-full min-w-0 items-center gap-2"
      data-slot="pier-diff-header-metadata"
    >
      {showNotice ? (
        <span
          className="min-w-0 truncate text-muted-foreground text-xs"
          data-slot="pier-diff-header-state-notice"
          title={stateNotice}
        >
          {stateNotice}
        </span>
      ) : null}
      {showStats ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
          data-slot="pier-diff-header-stats"
        >
          {deletions > 0 ? (
            <span
              data-pier-diff-stat="deletions"
              style={{
                color: "var(--diffs-deletion-base)",
                fontFamily:
                  "var(--diffs-font-family, var(--diffs-font-fallback))",
              }}
            >
              {`-${deletions}`}
            </span>
          ) : null}
          {additions > 0 ? (
            <span
              data-pier-diff-stat="additions"
              style={{
                color: "var(--diffs-addition-base)",
                fontFamily:
                  "var(--diffs-font-family, var(--diffs-font-fallback))",
              }}
            >
              {`+${additions}`}
            </span>
          ) : null}
        </span>
      ) : null}
      {driftSlot}
      {showRetry || (showStage && stageControl) ? (
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-0.5"
          data-slot="pier-diff-header-actions"
        >
          {showRetry ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    aria-label={retryLabel}
                    data-testid="pier-diff-retry-button"
                    onClick={() => onRetryItem?.(item.id)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw data-icon="inline-start" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{retryLabel}</TooltipContent>
            </Tooltip>
          ) : null}
          {showStage && stageControl ? (
            <DiffHeaderActions
              canDiscard={stageControl.canDiscard === true}
              labels={labels}
              {...(onDiscardFile
                ? { onDiscard: () => onDiscardFile(item.id) }
                : {})}
              onToggleStage={() => onToggleStage(item.id)}
              stageControl={stageControl}
            />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
