import { CollapseDiffButton, type PierDiffViewLabels } from "./collapse.tsx";
import { type DiffViewInputStore, useDiffViewInput } from "./input-store.ts";
import { fileDiffLineStats, type PierDiffCodeViewItem } from "./items.ts";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
} from "./presentation.ts";
import { DiffHeaderActions } from "./stage-button.tsx";

export function LiveHeaderPrefix({
  inputStore,
  item,
  labels,
  onToggle,
}: {
  readonly inputStore: DiffViewInputStore;
  readonly item: PierDiffCodeViewItem;
  readonly labels: PierDiffViewLabels;
  readonly onToggle: (item: PierDiffCodeViewItem) => void;
}): React.JSX.Element {
  const input = useDiffViewInput(inputStore, item.id);
  const loading =
    input !== undefined && pierDiffItemPresentation(input) === "loading";
  const emptyReady =
    !loading &&
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
  inputStore,
  item,
  labels,
  onDiscardFile,
  onToggleStage,
}: {
  readonly inputStore: DiffViewInputStore;
  readonly item: PierDiffCodeViewItem;
  readonly labels: PierDiffViewLabels;
  readonly onDiscardFile?: (itemId: string) => void;
  readonly onToggleStage?: (itemId: string) => void;
}): React.JSX.Element | null {
  const input = useDiffViewInput(inputStore, item.id);
  if (item.type !== "diff") {
    return null;
  }
  const loading =
    input !== undefined && pierDiffItemPresentation(input) === "loading";
  // 已解析 hunk 优先；estimate 用 index numstat 首屏齐刷（loading 时仍显示）
  const fromHunks = fileDiffLineStats(item.fileDiff);
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
  if (!(showStats || showStage || showNotice)) {
    return null;
  }
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
      {showStage && stageControl ? (
        <span
          className="ml-auto inline-flex shrink-0 items-center"
          data-slot="pier-diff-header-actions"
        >
          <DiffHeaderActions
            canDiscard={stageControl.canDiscard === true}
            labels={labels}
            {...(onDiscardFile
              ? { onDiscard: () => onDiscardFile(item.id) }
              : {})}
            onToggleStage={() => onToggleStage(item.id)}
            stageControl={stageControl}
          />
        </span>
      ) : null}
    </span>
  );
}
