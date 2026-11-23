import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { useEffect, useRef, useState } from "react";

export const GUTTER_TOOLTIP_DELAY_MS = 400;

export interface GutterTooltipAnchor {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface GutterTooltipPointer {
  readonly pointerY: number;
  readonly root: HTMLElement;
}

interface GutterHoverTooltipOptions {
  readonly enabled: boolean;
  readonly getRoot: () => HTMLElement | null;
  readonly resolveAnchor: (
    target: Element,
    pointer: GutterTooltipPointer
  ) => GutterTooltipAnchor | null;
  readonly selector: string;
}

/**
 * One delayed tooltip for a virtualized gutter. It owns the pointer delay and
 * the dismissal rules so every gutter hint behaves the same.
 */
export function useGutterHoverTooltip({
  enabled,
  getRoot,
  resolveAnchor,
  selector,
}: GutterHoverTooltipOptions): GutterTooltipAnchor | null {
  const [anchor, setAnchor] = useState<GutterTooltipAnchor | null>(null);
  const resolveRef = useRef(resolveAnchor);
  useEffect(() => {
    resolveRef.current = resolveAnchor;
  }, [resolveAnchor]);

  useEffect(() => {
    const root = getRoot();
    if (!(root && enabled)) {
      setAnchor(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: Element | null = null;
    let pointerY = 0;
    const leave = () => {
      clearTimeout(timer);
      previous = null;
      setAnchor(null);
    };
    const targetFor = (event: PointerEvent) =>
      event.target instanceof Element ? event.target.closest(selector) : null;
    const over = (event: PointerEvent) => {
      const target = targetFor(event);
      if (target === previous) return;
      leave();
      previous = target;
      if (!target) return;
      pointerY = event.clientY;
      timer = setTimeout(() => {
        setAnchor(resolveRef.current(target, { pointerY, root }));
      }, GUTTER_TOOLTIP_DELAY_MS);
    };
    const move = (event: PointerEvent) => {
      pointerY = event.clientY;
    };
    const out = (event: PointerEvent) => {
      if (!previous) return;
      const related = event.relatedTarget;
      if (related instanceof Node && previous.contains(related)) return;
      leave();
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerout", out);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerdown", leave);
    root.addEventListener("scroll", leave, true);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerdown", leave);
      root.removeEventListener("scroll", leave, true);
    };
  }, [enabled, getRoot, selector]);

  return anchor;
}

/** Renders the shared gutter hint; callers own the anchor geometry. */
export function GutterHoverTooltip({
  anchor,
  collisionBoundary,
  label,
}: {
  readonly anchor: GutterTooltipAnchor | null;
  readonly collisionBoundary?: Element | null;
  readonly label: string;
}) {
  if (!anchor) {
    return null;
  }
  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute"
          data-slot="gutter-hover-tooltip-anchor"
          style={{
            height: anchor.height,
            left: anchor.left,
            top: anchor.top,
            width: anchor.width,
          }}
        />
      </TooltipTrigger>
      <TooltipContent
        {...(collisionBoundary ? { collisionBoundary } : {})}
        hideWhenDetached
        side="right"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
