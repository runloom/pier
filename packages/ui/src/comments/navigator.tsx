import { Button } from "@pier/ui/button.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ChevronDown, ChevronUp, MessageCircle, Trash2 } from "lucide-react";
import type { JSX, ReactElement } from "react";

function BottomBarTip({
  children,
  label,
}: {
  readonly children: ReactElement;
  readonly label: string;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** `bottom-4` + pill + slack. Apply on the scroll root while the bar is shown. */
export const COMMENT_NAVIGATOR_SCROLL_PAD_CLASS = "pb-14";

/**
 * Comment navigator (identity + n/N + prev/next + clear all).
 * Shared by git review, markdown preview, and canvas preview.
 * Callers omit mount when total < 1; this component assumes total >= 1.
 *
 * `floating` (default): `absolute bottom-*` pinned to the nearest positioned
 * ancestor. Mount it on a viewport-sized, non-scrolling frame (sibling of
 * `overflow-auto`), never inside the scroll root — otherwise the bar rides
 * the document. Scroll roots should use `COMMENT_NAVIGATOR_SCROLL_PAD_CLASS`
 * when the bar is mounted so the last line is not trapped under the pill.
 * Floating chrome is always bottom-center (markdown / git review / canvas).
 * Zoom lives in a separate bottom-right pill (`ImagePreviewControls`).
 *
 * `cluster`: inner controls only, for nesting in another bottom pill.
 * Not a second toolbar.
 */
export function CommentNavigator({
  activeIndex,
  className,
  clearLabel,
  layout = "floating",
  nextLabel,
  onClear,
  onNext,
  onPrevious,
  onRevealCurrent,
  positionLabel,
  previousLabel,
  toolbarLabel,
  total,
}: {
  readonly activeIndex: number;
  readonly className?: string;
  readonly clearLabel: string;
  readonly layout?: "cluster" | "floating";
  readonly nextLabel: string;
  readonly onClear: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  /** Re-reveal the current item (needed when total === 1 so n/N still open). */
  readonly onRevealCurrent: () => void;
  readonly positionLabel: string;
  readonly previousLabel: string;
  readonly toolbarLabel: string;
  readonly total: number;
}): JSX.Element {
  const clustered = layout === "cluster";
  const iconSize = clustered ? "icon-sm" : "icon-xs";
  const textSize = clustered ? "sm" : "xs";
  const positionText = `${activeIndex + 1}/${total}`;
  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        clustered
          ? undefined
          : "pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-popover px-1.5 py-1 text-sm shadow-md",
        className
      )}
      data-slot="comment-navigator"
      data-testid="comment-navigator"
      {...(clustered
        ? {}
        : { "aria-label": toolbarLabel, role: "toolbar" as const })}
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center text-muted-foreground"
      >
        <MessageCircle aria-hidden className="size-3.5" data-icon />
      </span>
      <BottomBarTip label={positionLabel}>
        <span className="inline-flex">
          <Button
            aria-label={positionLabel}
            aria-live="polite"
            className="min-w-10 px-1 tabular-nums"
            onClick={onRevealCurrent}
            size={textSize}
            type="button"
            variant="ghost"
          >
            <span aria-hidden>{positionText}</span>
          </Button>
        </span>
      </BottomBarTip>
      <BottomBarTip label={previousLabel}>
        <span className="inline-flex">
          <Button
            aria-label={previousLabel}
            onClick={onPrevious}
            size={iconSize}
            type="button"
            variant="ghost"
          >
            <ChevronUp aria-hidden data-icon />
          </Button>
        </span>
      </BottomBarTip>
      <BottomBarTip label={nextLabel}>
        <span className="inline-flex">
          <Button
            aria-label={nextLabel}
            onClick={onNext}
            size={iconSize}
            type="button"
            variant="ghost"
          >
            <ChevronDown aria-hidden data-icon />
          </Button>
        </span>
      </BottomBarTip>
      <Separator className="mx-0.5 h-4 self-center" orientation="vertical" />
      <BottomBarTip label={clearLabel}>
        <span className="inline-flex">
          <Button
            aria-label={clearLabel}
            onClick={onClear}
            size={iconSize}
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden data-icon />
          </Button>
        </span>
      </BottomBarTip>
    </div>
  );
}

/** @deprecated Prefer `CommentNavigator`; kept for git review import stability. */
export const ReviewCommentNavigator = CommentNavigator;
