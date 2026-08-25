import { type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Floating definition preview for a markdown footnote reference.
 *
 * Content is rendered from IR (not cloned from DOM), so the popover works
 * even when the definition lives on a lazily-rendered pagination page that
 * has not been mounted yet.
 */

const POPOVER_MAX_WIDTH_PX = 320;
const POPOVER_GAP_PX = 12;
const POPOVER_FLIP_THRESHOLD_PX = 220;
const POPOVER_HORIZONTAL_MARGIN_PX = POPOVER_GAP_PX;

export function FootnotePopover(props: {
  anchorElement: HTMLElement;
  content: ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const update = () => setRect(props.anchorElement.getBoundingClientRect());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [props.anchorElement]);

  if (!(rect && props.content)) return null;

  const maxLeft =
    window.innerWidth - POPOVER_MAX_WIDTH_PX - POPOVER_HORIZONTAL_MARGIN_PX;
  const left = Math.min(
    Math.max(rect.left, POPOVER_HORIZONTAL_MARGIN_PX),
    maxLeft
  );
  const above = rect.top > POPOVER_FLIP_THRESHOLD_PX;
  const top = above ? rect.top - POPOVER_GAP_PX : rect.bottom + POPOVER_GAP_PX;
  return createPortal(
    <div
      className="md-footnote-popover"
      role="tooltip"
      style={{
        left,
        ...(above
          ? { bottom: window.innerHeight - rect.top + POPOVER_GAP_PX }
          : { top }),
      }}
    >
      {props.content}
    </div>,
    document.body
  );
}
