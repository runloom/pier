import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitCounts, GitDelta, GitStatus } from "@shared/contracts/git.ts";
import { GitCompareArrows } from "lucide-react";
import type React from "react";
import { pluginText } from "./git-plugin-text.ts";
import { repoOperationHasConflicts } from "./git-status-parts.tsx";

const LINE_DELETION_SIGN = "\u2212";

const EMPTY_COUNTS: GitCounts = {
  conflict: 0,
  modified: 0,
  staged: 0,
  untracked: 0,
};

function totalFileChanges(counts: GitCounts): number {
  return counts.conflict + counts.modified + counts.staged + counts.untracked;
}

function hasLineDelta(delta: GitDelta | null): boolean {
  return Boolean(delta && (delta.insertions > 0 || delta.deletions > 0));
}

/** 与底栏挂载/空壳判定共用：仅有本地变更时才有更改项内容。 */
export function gitChangesStatusHasContent(status: GitStatus): boolean {
  return totalFileChanges(status.counts ?? EMPTY_COUNTS) > 0;
}

/**
 * 状态栏独立更改项（与分支身份、同步项并列）：
 * - 仅有本地变更时出现；干净时隐藏；
 * - 扁平 ghost：图标 + 彩色 `+N −M`（无行级统计时退回文件数）；
 * - 无 tooltip；单击直接打开审查 panel。
 */
export function GitChangesStatusButton({
  onOpenChanges,
  pluginContext,
  status,
}: {
  onOpenChanges: () => void;
  pluginContext: RendererPluginContext;
  status: GitStatus;
}): React.ReactElement | null {
  if (!gitChangesStatusHasContent(status)) {
    return null;
  }
  const counts = status.counts ?? EMPTY_COUNTS;
  const total = totalFileChanges(counts);
  const delta = status.delta;
  const showDelta = hasLineDelta(delta);
  const hasConflicts =
    counts.conflict > 0 || repoOperationHasConflicts(status.repoState);
  const openLabel = pluginText(
    pluginContext,
    "statusChangesOpenLabel",
    "Open changes"
  );
  const ariaLabel = [
    openLabel,
    showDelta
      ? `${delta?.insertions ?? 0} ${pluginText(pluginContext, "srInsertions", "insertions")}, ${delta?.deletions ?? 0} ${pluginText(pluginContext, "srDeletions", "deletions")}`
      : `${total} ${pluginText(pluginContext, "statusChangesFiles", "files")}`,
    hasConflicts ? pluginText(pluginContext, "srConflict", "conflicts") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Button
      aria-label={ariaLabel}
      className={STATUS_BAR_ITEM_TRIGGER_CLASS}
      data-testid="git-changes-status-trigger"
      onClick={onOpenChanges}
      size="status-bar"
      type="button"
      variant="ghost"
    >
      <GitCompareArrows
        aria-hidden="true"
        className={cn(hasConflicts && "text-status-danger-fg")}
        data-git-icon="git-changes"
        data-icon
      />
      {showDelta ? (
        <span className="inline-flex items-center gap-1 tabular-nums">
          {(delta?.insertions ?? 0) > 0 ? (
            <span className="text-success" data-git-delta="insertions">
              +{delta?.insertions}
            </span>
          ) : null}
          {(delta?.deletions ?? 0) > 0 ? (
            <span className="text-status-danger-fg" data-git-delta="deletions">
              {LINE_DELETION_SIGN}
              {delta?.deletions}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="tabular-nums">{total}</span>
      )}
    </Button>
  );
}
