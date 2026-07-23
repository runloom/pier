import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  AlignLeft,
  Columns2,
  FoldVertical,
  RefreshCw,
  Rows3,
  UnfoldVertical,
  WrapText,
} from "lucide-react";
import { pluginText } from "./git-plugin-text.ts";
import type { ReviewViewOptions } from "./git-review-document-ui-state.ts";

/** Changes 面板 header 的 diff 视图工具栏:视图/换行/折叠均为 toggle，刷新为动作。 */
export function GitReviewToolbar({
  allCollapsed,
  context,
  onRefresh,
  onToggleCollapseAll,
  refreshing,
  setViewOptions,
  viewOptions,
}: {
  /** true = 当前为全部折叠，图标显示「展开」。 */
  readonly allCollapsed: boolean;
  readonly context: RendererPluginContext;
  readonly onRefresh: () => void;
  readonly onToggleCollapseAll: () => void;
  readonly refreshing: boolean;
  readonly setViewOptions: (patch: Partial<ReviewViewOptions>) => void;
  readonly viewOptions: ReviewViewOptions;
}): React.JSX.Element {
  const split = viewOptions.diffStyle === "split";
  const wrap = viewOptions.wrapLines;
  const diffStyleLabel = split
    ? pluginText(context, "reviewToolbarUnified", "Switch to inline view")
    : pluginText(context, "reviewToolbarSplit", "Switch to side-by-side view");
  const wrapLabel = wrap
    ? pluginText(context, "reviewToolbarNoWrap", "Disable line wrapping")
    : pluginText(context, "reviewToolbarWrap", "Wrap lines");
  const collapseToggleLabel = allCollapsed
    ? pluginText(context, "reviewToolbarExpandAll", "Expand all files")
    : pluginText(context, "reviewToolbarCollapseAll", "Collapse all files");
  const refreshLabel = pluginText(context, "reviewToolbarRefresh", "Refresh");

  return (
    <div className="flex items-center gap-0.5" data-testid="git-review-toolbar">
      <ToolbarIconButton
        label={diffStyleLabel}
        onClick={() =>
          setViewOptions({ diffStyle: split ? "unified" : "split" })
        }
        pressed={split}
      >
        {split ? <Columns2 data-icon /> : <Rows3 data-icon />}
      </ToolbarIconButton>
      <ToolbarIconButton
        label={wrapLabel}
        onClick={() => setViewOptions({ wrapLines: !wrap })}
        pressed={wrap}
      >
        {wrap ? <WrapText data-icon /> : <AlignLeft data-icon />}
      </ToolbarIconButton>
      <ToolbarIconButton
        label={collapseToggleLabel}
        onClick={onToggleCollapseAll}
        pressed={allCollapsed}
      >
        {allCollapsed ? (
          <UnfoldVertical data-icon />
        ) : (
          <FoldVertical data-icon />
        )}
      </ToolbarIconButton>
      <ToolbarIconButton
        disabled={refreshing}
        label={refreshLabel}
        onClick={onRefresh}
      >
        <RefreshCw className={cn(refreshing && "animate-spin")} data-icon />
      </ToolbarIconButton>
    </div>
  );
}

function ToolbarIconButton({
  children,
  disabled = false,
  label,
  onClick,
  pressed,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip>
      {/*
        span carries the trigger ref. Button is not forwardRef, so Radix cannot
        anchor the tooltip if asChild is placed directly on Button.
      */}
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            aria-label={label}
            {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
            disabled={disabled}
            onClick={onClick}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent align="center" side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
