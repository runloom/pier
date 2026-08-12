import { Button } from "@pier/ui/button.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import type { JSX } from "react";

/**
 * Floating comment navigator (identity + n/N + prev/next + clear all).
 * Shared by git review, markdown preview, and canvas preview.
 * Callers omit mount when total < 1; this component assumes total >= 1.
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
      <span
        aria-live="polite"
        className="min-w-10 px-1 text-center text-muted-foreground tabular-nums"
        title={positionLabel}
      >
        <span className="sr-only">{positionLabel}</span>
        <span aria-hidden>{positionText}</span>
      </span>
      <Button
        aria-label={previousLabel}
        disabled={total <= 1}
        onClick={onPrevious}
        size="icon-xs"
        title={previousLabel}
        type="button"
        variant="ghost"
      >
        <ChevronUp aria-hidden data-icon />
      </Button>
      <Button
        aria-label={nextLabel}
        disabled={total <= 1}
        onClick={onNext}
        size="icon-xs"
        title={nextLabel}
        type="button"
        variant="ghost"
      >
        <ChevronDown aria-hidden data-icon />
      </Button>
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
