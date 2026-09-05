import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { type RefObject, useEffect, useState } from "react";

/** One delayed tooltip for the virtualized CM gutter; no per-line Tab stops. */
export function SourceGutterTooltip({
  rootRef,
  label,
  enabled,
}: {
  rootRef: RefObject<HTMLElement | null>;
  label: string;
  enabled: boolean;
}) {
  const [anchor, setAnchor] = useState<{
    top: number;
    left: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!(root && enabled)) {
      setAnchor(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: Element | null = null;
    const leave = () => {
      clearTimeout(timer);
      previous = null;
      setAnchor(null);
    };
    const over = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(
              ".cm-gitRow-added, .cm-gitRow-modified, .cm-gitRow-deleted"
            )
          : null;
      if (target === previous) return;
      leave();
      previous = target;
      if (!target) return;
      timer = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        setAnchor({
          top: rect.top - bounds.top,
          left: rect.left - bounds.left,
          height: rect.height,
        });
      }, 400);
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("scroll", leave, true);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("scroll", leave, true);
    };
  }, [rootRef, enabled]);
  return anchor ? (
    <Tooltip open>
      <TooltipTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute w-4"
          style={anchor}
        />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ) : null;
}
