import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitCounts, GitStatus } from "@shared/contracts/git.ts";
import { GitCompareArrows } from "lucide-react";
import type React from "react";
import {
  GitChangeSummaryInline,
  gitChangeSummaryAccessibleLabel,
} from "./git-change-summary-display.tsx";
import { pluginText } from "./git-plugin-text.ts";
import { repoOperationHasConflicts } from "./git-status-parts.tsx";

const EMPTY_COUNTS: GitCounts = {
  conflict: 0,
  modified: 0,
  staged: 0,
  untracked: 0,
};

/** 与底栏挂载/空壳判定共用：仅有本地变更时才有更改项内容。 */
export function gitChangesStatusHasContent(status: GitStatus): boolean {
  return status.changeSummary.changedFiles > 0;
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
  const hasConflicts =
    counts.conflict > 0 || repoOperationHasConflicts(status.repoState);
  const openLabel = pluginText(
    pluginContext,
    "statusChangesOpenLabel",
    "Open changes"
  );
  const ariaLabel = [
    openLabel,
    gitChangeSummaryAccessibleLabel(pluginContext, status.changeSummary),
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
      <GitChangeSummaryInline
        context={pluginContext}
        summary={status.changeSummary}
      />
    </Button>
  );
}
