import { useReactFlow } from "@xyflow/react";
import { type RefObject, useEffect } from "react";
import { FIT_VIEW_OPTIONS } from "./model.ts";

export type FitViewOptions = typeof FIT_VIEW_OPTIONS;

/** Fit after the surface has non-zero layout size (stage/card first paint). */
export function FitViewOnViewportChange({
  containerRef,
  fitViewOptions = FIT_VIEW_OPTIONS,
  token,
}: {
  containerRef: RefObject<HTMLElement | null>;
  fitViewOptions?: FitViewOptions | undefined;
  token: string;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    let fitted = false;
    let ro: ResizeObserver | null = null;
    let outerFrame = 0;
    let innerFrame = 0;

    const attempt = () => {
      if (cancelled || fitted) {
        return;
      }
      const el = containerRef.current;
      if (!el) {
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      if (width < 8 || height < 8) {
        return;
      }
      fitted = true;
      fitView(fitViewOptions).catch(() => undefined);
      ro?.disconnect();
      ro = null;
    };

    const layoutToken = token;

    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (layoutToken.length === 0) {
          return;
        }
        attempt();
      });
    });

    const el = containerRef.current;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => attempt());
      ro.observe(el);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      ro?.disconnect();
    };
  }, [containerRef, fitView, fitViewOptions, token]);
  return null;
}
