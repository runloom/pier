import { Button } from "@pier/ui/button.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
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
 * Floating comment navigator (identity + n/N + prev/next + clear all).
 * Shared by git review, markdown preview, and canvas preview.
 * Callers omit mount when total < 1; this component assumes total >= 1.
 *
 * `absolute bottom-*` is pinned to the nearest positioned ancestor. Mount it
 * on a viewport-sized, non-scrolling frame (sibling of `overflow-auto`),
 * never inside the scroll root — otherwise the bar rides the document.
 * Scroll roots should use `COMMENT_NAVIGATOR_SCROLL_PAD_CLASS` when the bar
 * is mounted so the last line is not trapped under the pill.
 */
export function CommentNavigator({
  activeIndex,
  className,
  clearLabel,
  nextLabel,
  onClear,
  onNext,
  onPrevious,
  positionLabel,
  previousLabel,
  toolbarLabel,
  total,
}: {
  readonly activeIndex: number;
  readonly className?: string;
  readonly clearLabel: string;
  readonly nextLabel: string;
  readonly onClear: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly positionLabel: string;
  readonly previousLabel: string;
  readonly toolbarLabel: string;
  readonly total: number;
}): JSX.Element {
  const positionText = `${activeIndex + 1}/${total}`;
  return (
    <div
      aria-label={toolbarLabel}
      className={cn(
        "pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-popover px-1.5 py-1 text-sm shadow-md",
        className
      )}
      data-slot="comment-navigator"
      data-testid="comment-navigator"
      role="toolbar"
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center text-muted-foreground"
      >
        <MessageSquare className="size-3.5" />
      </span>
      <BottomBarTip label={positionLabel}>
        <span
          aria-live="polite"
          className="min-w-10 px-1 text-center text-muted-foreground tabular-nums"
        >
          <span className="sr-only">{positionLabel}</span>
          <span aria-hidden>{positionText}</span>
        </span>
      </BottomBarTip>
      <BottomBarTip label={previousLabel}>
        <span className="inline-flex">
          <Button
            aria-label={previousLabel}
            disabled={total <= 1}
            onClick={onPrevious}
            size="icon-xs"
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
            disabled={total <= 1}
            onClick={onNext}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronDown aria-hidden data-icon />
          </Button>
        </span>
      </BottomBarTip>
      <Separator className="mx-0.5 h-4 self-center" orientation="vertical" />
      <Button
        className="rounded-full px-2.5"
        onClick={onClear}
        size="xs"
        type="button"
        variant="ghost"
      >
        {clearLabel}
      </Button>
    </div>
  );
}

/** @deprecated Prefer `CommentNavigator`; kept for git review import stability. */
export const ReviewCommentNavigator = CommentNavigator;
