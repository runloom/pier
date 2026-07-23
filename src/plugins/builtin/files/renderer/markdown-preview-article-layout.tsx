import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  MARKDOWN_TOC_EDGE_INSET_PX,
  MARKDOWN_TOC_TOP_RATIO,
  markdownOutlineHoverMaxHeightPx,
  markdownOutlineHoverWidthPx,
} from "./markdown-preview-toc-layout.ts";

export function useMarkdownOutlineLayout(params: {
  fontScale: number;
  hasHeadings: boolean;
  ready: boolean;
}): {
  maxHeightPx: number;
  panelWidthPx: number;
  previewFrameRef: (node: HTMLDivElement | null) => void;
  scrollRoot: HTMLDivElement | null;
  scrollRootRef: (node: HTMLDivElement | null) => void;
} {
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [maxHeightPx, setMaxHeightPx] = useState(0);
  const [panelWidthPx, setPanelWidthPx] = useState(0);

  useEffect(() => {
    if (!(params.ready && scrollRoot && previewFrame && params.hasHeadings)) {
      setMaxHeightPx(0);
      setPanelWidthPx(0);
      return;
    }
    let raf = 0;
    const updateLayout = () => {
      // Reading zoom can change prose metrics via --md-scale without resizing.
      if (params.fontScale <= 0) {
        return;
      }
      // Clamp to the preview frame so the hover card never escapes overflow-hidden.
      setMaxHeightPx(
        markdownOutlineHoverMaxHeightPx(previewFrame.clientHeight)
      );
      setPanelWidthPx(markdownOutlineHoverWidthPx(previewFrame.clientWidth));
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
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    params.fontScale,
    params.hasHeadings,
    params.ready,
    previewFrame,
    scrollRoot,
  ]);

  return {
    maxHeightPx,
    panelWidthPx,
    previewFrameRef: setPreviewFrame,
    scrollRoot,
    scrollRootRef: setScrollRoot,
  };
}

/**
 * Floating outline rail on the preview frame. Width matches the hover panel
 * slot; height hugs the tick stack (maxHeight only clamps). Empty slot space is
 * pointer-events-none so prose stays clickable underneath.
 */
export function MarkdownPreviewOverlayRail({
  children,
  maxHeightPx,
  panelWidthPx,
}: {
  children: ReactNode;
  maxHeightPx: number;
  panelWidthPx: number;
}) {
  const style: CSSProperties = {
    top: `${MARKDOWN_TOC_TOP_RATIO * 100}%`,
    right: MARKDOWN_TOC_EDGE_INSET_PX,
    width: panelWidthPx > 0 ? panelWidthPx : undefined,
    ...(maxHeightPx > 0 ? { maxHeight: maxHeightPx } : {}),
  };
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-col items-end"
      data-side="right"
      data-slot="markdown-preview-outline-rail"
      style={style}
    >
      <div className="pointer-events-none relative w-full max-w-full">
        {children}
      </div>
    </div>
  );
}

/**
 * Article row wrapper. Outline always mounts on the preview-frame overlay rail
 * (Notion tick style); this slot only centers the prose column.
 */
export function MarkdownPreviewArticleLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-full"
      data-placement="overlay"
      data-slot="markdown-preview-layout"
    >
      {children}
    </div>
  );
}
