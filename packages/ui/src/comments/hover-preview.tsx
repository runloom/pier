/**
 * Glance preview for an existing comment (canvas / markdown pin).
 * Sized to the text; the floating shell (HoverCard) is portaled so parent
 * overflow cannot clip it or steal the pin's overlay on the document.
 */
import type { ReactNode } from "react";
import { TOOLTIP_COLLISION_PADDING } from "../tooltip.tsx";

/** Overrides HoverCardContent's default `w-72 p-4` so short notes hug. */
export const COMMENT_HOVER_CARD_CLASS =
  "w-fit max-w-72 rounded-2xl p-2.5 shadow-lg";

/**
 * Shared Popover/HoverCard chrome when the composer already paints its own
 * card. Transparent so we do not double-shell.
 */
export const COMMENT_FLOATER_CONTENT_CLASS =
  "w-fit max-w-80 border-0 bg-transparent p-0 shadow-none";

/**
 * Preferred placement: beside the trigger/click. Collision handling is the
 * same Radix Popper path as product tooltips (`avoidCollisions` + padding) so
 * the floater flips/shifts instead of painting off-screen.
 */
export const COMMENT_FLOATER_POSITION = {
  align: "center",
  avoidCollisions: true,
  collisionPadding: TOOLTIP_COLLISION_PADDING,
  side: "right",
  sideOffset: 8,
} as const;

export function CommentHoverPreview(props: {
  readonly items: readonly {
    readonly body: string;
    readonly id: string;
  }[];
}): ReactNode {
  if (props.items.length === 0) {
    return null;
  }
  return (
    <div
      className="flex max-h-40 flex-col gap-1.5 overflow-y-auto"
      data-slot="comment-hover-preview"
    >
      {props.items.map((item) => (
        <p
          className="w-fit max-w-full whitespace-pre-wrap break-words text-foreground text-sm"
          key={item.id}
        >
          {item.body}
        </p>
      ))}
    </div>
  );
}
