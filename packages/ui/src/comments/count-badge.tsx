/**
 * Reading-comment pin (markdown / canvas).
 *
 * Identifier is Lucide `MessageCircle` (round bubble, tail at bottom-left),
 * filled with action-accent and a light stroke — the Codex comment marker.
 * The number sits in the bubble body, not on a separate chip.
 */
import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { MessageCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

function CommentCountBadgeGlyph(props: { readonly count: number }): ReactNode {
  const compact = props.count >= 10;
  return (
    <span className="relative inline-flex size-6 items-center justify-center">
      <MessageCircle
        aria-hidden
        className="absolute inset-0 size-full fill-action-accent stroke-action-accent-foreground"
        data-icon
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "relative -translate-y-px font-semibold text-action-accent-foreground tabular-nums leading-none",
          compact ? "text-[9px]" : "text-[10px]"
        )}
      >
        {props.count}
      </span>
    </span>
  );
}

const BADGE_BUTTON_CLASS =
  "relative size-6 cursor-pointer overflow-visible p-0 shadow-none hover:bg-transparent hover:brightness-110 focus-visible:ring-ring/40";

/** Non-interactive mark (draft overlay). */
export function CommentCountBadgeStatic(props: {
  readonly className?: string;
  readonly count: number;
}): ReactNode {
  return (
    <span
      aria-hidden
      className={cn("inline-flex overflow-visible", props.className)}
      data-slot="comment-count-badge"
    >
      <CommentCountBadgeGlyph count={props.count} />
    </span>
  );
}

export function CommentCountBadge({
  className,
  count,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  readonly count: number;
}): ReactNode {
  return (
    <Button
      className={cn(BADGE_BUTTON_CLASS, className)}
      data-slot="comment-count-badge"
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      <CommentCountBadgeGlyph count={count} />
    </Button>
  );
}
