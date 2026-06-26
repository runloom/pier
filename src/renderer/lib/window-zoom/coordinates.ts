import { windowZoomFactor } from "@shared/zoom.ts";

export interface CssPoint {
  x: number;
  y: number;
}

export interface CssRect extends CssPoint {
  height: number;
  width: number;
}

function scale(value: number, factor: number): number {
  return Math.round(value * factor * 1000) / 1000;
}

export function cssPointToContentViewPoint(
  point: CssPoint,
  windowZoomLevel: number
): CssPoint {
  const factor = windowZoomFactor(windowZoomLevel);
  return {
    x: scale(point.x, factor),
    y: scale(point.y, factor),
  };
}

export function cssRectToContentViewRect(
  rect: CssRect,
  windowZoomLevel: number
): CssRect {
  const factor = windowZoomFactor(windowZoomLevel);
  return {
    height: scale(rect.height, factor),
    width: scale(rect.width, factor),
    x: scale(rect.x, factor),
    y: scale(rect.y, factor),
  };
}
