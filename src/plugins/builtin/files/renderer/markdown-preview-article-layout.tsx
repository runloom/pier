import { cn } from "@pier/ui/utils.ts";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import type {
  MarkdownMeasureMode,
  MarkdownTocSide,
} from "./markdown-preview-preferences.ts";
import {
  canDockMarkdownOutline,
  MARKDOWN_PREVIEW_EDGE_INSET_PX,
  MARKDOWN_TOC_INSET_PX,
  MARKDOWN_TOC_RAIL_WIDTH_PX,
  type MarkdownTocPlacement,
  markdownOutlineFrameHeightPx,
  readMarkdownContentWidthPx,
  readScrollContentWidthPx,
} from "./markdown-preview-toc-layout.ts";

export function useMarkdownOutlineLayout(params: {
  fontScale: number;
  hasHeadings: boolean;
  measureMode: MarkdownMeasureMode;
  ready: boolean;
}): {
  maxHeightPx: number;
  placement: MarkdownTocPlacement;
  previewFrameRef: (node: HTMLDivElement | null) => void;
  scrollRoot: HTMLDivElement | null;
  scrollRootRef: (node: HTMLDivElement | null) => void;
} {
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<MarkdownTocPlacement>("overlay");
  const [maxHeightPx, setMaxHeightPx] = useState(0);

  useEffect(() => {
    if (!(params.ready && scrollRoot && previewFrame)) {
      setPlacement("overlay");
      setMaxHeightPx(0);
      return;
    }
    let raf = 0;
    const updateLayout = () => {
      // Reading zoom can change prose width via --md-scale without resizing the
      // scroll root; keep fontScale in deps and bail on invalid scale.
      if (params.fontScale <= 0) {
        return;
      }
      const prose = scrollRoot.querySelector<HTMLElement>(
        '[data-slot="markdown-prose"]'
      );
      setPlacement(
        canDockMarkdownOutline({
          availableWidthPx: readScrollContentWidthPx(scrollRoot),
          contentWidthPx: readMarkdownContentWidthPx(prose),
          hasHeadings: params.hasHeadings,
          measureMode: params.measureMode,
        })
          ? "dock"
          : "overlay"
      );
      setMaxHeightPx(markdownOutlineFrameHeightPx(scrollRoot.clientHeight));
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateLayout);
    };
    scheduleUpdate();
    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(raf);
    }
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scrollRoot);
    observer.observe(previewFrame);
    const prose = scrollRoot.querySelector<HTMLElement>(
      '[data-slot="markdown-prose"]'
    );
    if (prose) observer.observe(prose);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    params.fontScale,
    params.hasHeadings,
    params.measureMode,
    params.ready,
    previewFrame,
    scrollRoot,
  ]);

  return {
    maxHeightPx,
    placement,
    previewFrameRef: setPreviewFrame,
    scrollRoot,
    scrollRootRef: setScrollRoot,
  };
}

/**
 * Floating outline rail on the preview frame — same containing block and edge
 * inset as the font-scale control. Left/right sides pin to the matching edge;
 * `items-end` / `items-start` keep collapsed chips on that outer edge.
 */
export function MarkdownPreviewOverlayRail({
  children,
  side,
}: {
  children: ReactNode;
  side: MarkdownTocSide;
}) {
  const style: CSSProperties = {
    top: MARKDOWN_TOC_INSET_PX,
    width: MARKDOWN_TOC_RAIL_WIDTH_PX,
    ...(side === "left"
      ? { left: MARKDOWN_PREVIEW_EDGE_INSET_PX }
      : { right: MARKDOWN_PREVIEW_EDGE_INSET_PX }),
  };
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-20 flex flex-col",
        side === "right" ? "items-end" : "items-start"
      )}
      data-side={side}
      data-slot="markdown-preview-outline-rail"
      style={style}
    >
      <div className="pointer-events-auto flex max-w-full flex-col items-stretch">
        {children}
      </div>
    </div>
  );
}

/**
 * Article row for comfortable dock (in-flow outline + prose). Overlay outline
 * is mounted on the preview frame via `MarkdownPreviewOverlayRail`.
 */
export function MarkdownPreviewArticleLayout({
  children,
  outline,
  placement,
  tocSide,
}: {
  children: ReactNode;
  outline: ReactNode;
  placement: MarkdownTocPlacement;
  tocSide: MarkdownTocSide;
}) {
  const docked = placement === "dock";

  return (
    <div
      className={cn(
        "relative mx-auto max-w-full",
        docked ? "flex w-fit gap-4" : "w-full"
      )}
      data-placement={placement}
      data-slot="markdown-preview-layout"
    >
      {docked && tocSide === "left" ? outline : null}
      {children}
      {docked && tocSide === "right" ? outline : null}
    </div>
  );
}
