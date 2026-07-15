"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChartTooltipContent, useChart } from "./chart.tsx";

const CHART_TOOLTIP_OFFSET = 10;
const CHART_TOOLTIP_VIEWPORT_PADDING = 8;

function resolveChartTooltipAxisPosition({
  anchor,
  offset,
  size,
  viewportSize,
}: {
  anchor: number;
  offset: number;
  size: number;
  viewportSize: number;
}): number {
  const maximum = Math.max(
    CHART_TOOLTIP_VIEWPORT_PADDING,
    viewportSize - size - CHART_TOOLTIP_VIEWPORT_PADDING
  );
  const preferred = anchor + offset;
  const flipped = anchor - size - offset;
  const position =
    preferred + size <= viewportSize - CHART_TOOLTIP_VIEWPORT_PADDING
      ? preferred
      : flipped;
  return Math.min(Math.max(position, CHART_TOOLTIP_VIEWPORT_PADDING), maximum);
}

export function ChartTooltipPortalContent({
  anchorRef,
  coordinate,
  ...props
}: React.ComponentProps<typeof ChartTooltipContent> & {
  anchorRef: React.RefObject<HTMLElement | null>;
  coordinate?: { x?: number; y?: number };
}) {
  const { chartId } = useChart();
  const [anchorGeometry, setAnchorGeometry] = React.useState<{
    left: number;
    top: number;
    viewportHeight: number;
    viewportWidth: number;
  } | null>(null);
  const [tooltipNode, setTooltipNode] = React.useState<HTMLDivElement | null>(
    null
  );
  const [tooltipSize, setTooltipSize] = React.useState({
    height: 0,
    width: 0,
  });
  const isVisible = Boolean(props.active && props.payload?.length);

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!(isVisible && anchor)) {
      return;
    }
    const updateGeometry = () => {
      const { left, top } = anchor.getBoundingClientRect();
      const next = {
        left,
        top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
      setAnchorGeometry((current) =>
        current?.left === next.left &&
        current.top === next.top &&
        current.viewportHeight === next.viewportHeight &&
        current.viewportWidth === next.viewportWidth
          ? current
          : next
      );
    };
    updateGeometry();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateGeometry);
    observer?.observe(anchor);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [anchorRef, isVisible]);

  React.useLayoutEffect(() => {
    if (!(isVisible && tooltipNode)) {
      return;
    }
    const updateSize = () => {
      const { height, width } = tooltipNode.getBoundingClientRect();
      setTooltipSize((current) =>
        current.height === height && current.width === width
          ? current
          : { height, width }
      );
    };
    updateSize();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateSize);
    observer?.observe(tooltipNode);
    return () => observer?.disconnect();
  }, [isVisible, tooltipNode]);

  if (
    !(isVisible && anchorGeometry) ||
    typeof document === "undefined" ||
    typeof coordinate?.x !== "number" ||
    typeof coordinate.y !== "number"
  ) {
    return null;
  }

  const left = resolveChartTooltipAxisPosition({
    anchor: anchorGeometry.left + coordinate.x,
    offset: CHART_TOOLTIP_OFFSET,
    size: tooltipSize.width,
    viewportSize: anchorGeometry.viewportWidth,
  });
  const top = resolveChartTooltipAxisPosition({
    anchor: anchorGeometry.top + coordinate.y,
    offset: CHART_TOOLTIP_OFFSET,
    size: tooltipSize.height,
    viewportSize: anchorGeometry.viewportHeight,
  });

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 max-w-[calc(100vw-1rem)]"
      data-chart={chartId}
      data-slot="chart-tooltip-portal"
      ref={setTooltipNode}
      style={{ left, top }}
    >
      <ChartTooltipContent {...props} />
    </div>,
    document.body
  );
}
