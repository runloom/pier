import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  RefreshCw,
  Rows3,
  WrapText,
} from "lucide-react";
import { pluginText } from "./git-plugin-text.ts";
import type { ReviewViewOptions } from "./git-review-document-ui-state.ts";

/** Changes 面板 header 的 diff 视图工具栏:视图切换/换行/折叠/手动刷新。 */
export function GitReviewToolbar({
  context,
  onCollapseAll,
  onExpandAll,
  onRefresh,
  refreshing,
  setViewOptions,
  viewOptions,
}: {
  readonly context: RendererPluginContext;
  readonly onCollapseAll: () => void;
  readonly onExpandAll: () => void;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
  readonly setViewOptions: (patch: Partial<ReviewViewOptions>) => void;
  readonly viewOptions: ReviewViewOptions;
}): React.JSX.Element {
  const split = viewOptions.diffStyle === "split";
  const diffStyleLabel = split
    ? pluginText(context, "reviewToolbarUnified", "Switch to inline view")
    : pluginText(context, "reviewToolbarSplit", "Switch to side-by-side view");
  const wrapLabel = viewOptions.wrapLines
    ? pluginText(context, "reviewToolbarNoWrap", "Disable line wrapping")
    : pluginText(context, "reviewToolbarWrap", "Wrap lines");
  const collapseAllLabel = pluginText(
    context,
    "reviewToolbarCollapseAll",
    "Collapse all files"
  );
  const expandAllLabel = pluginText(
    context,
    "reviewToolbarExpandAll",
    "Expand all files"
  );
  const refreshLabel = pluginText(context, "reviewToolbarRefresh", "Refresh");
  return (
    <div className="flex items-center gap-0.5" data-testid="git-review-toolbar">
      <Button
        aria-label={diffStyleLabel}
        onClick={() =>
          setViewOptions({ diffStyle: split ? "unified" : "split" })
        }
        size="icon-xs"
        title={diffStyleLabel}
        type="button"
        variant="ghost"
      >
        {split ? <Rows3 data-icon /> : <Columns2 data-icon />}
      </Button>
      <Button
        aria-label={wrapLabel}
        aria-pressed={viewOptions.wrapLines}
        onClick={() => setViewOptions({ wrapLines: !viewOptions.wrapLines })}
        size="icon-xs"
        title={wrapLabel}
        type="button"
        variant={viewOptions.wrapLines ? "secondary" : "ghost"}
      >
        <WrapText data-icon />
      </Button>
      <Button
        aria-label={collapseAllLabel}
        onClick={onCollapseAll}
        size="icon-xs"
        title={collapseAllLabel}
        type="button"
        variant="ghost"
      >
        <ChevronsDownUp data-icon />
      </Button>
      <Button
        aria-label={expandAllLabel}
        onClick={onExpandAll}
        size="icon-xs"
        title={expandAllLabel}
        type="button"
        variant="ghost"
      >
        <ChevronsUpDown data-icon />
      </Button>
      <Button
        aria-label={refreshLabel}
        disabled={refreshing}
        onClick={onRefresh}
        size="icon-xs"
        title={refreshLabel}
        type="button"
        variant="ghost"
      >
        <RefreshCw className={cn(refreshing && "animate-spin")} data-icon />
      </Button>
    </div>
  );
}
