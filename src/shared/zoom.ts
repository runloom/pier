import {
  DEFAULT_WINDOW_ZOOM_LEVEL,
  MAX_WINDOW_ZOOM_LEVEL,
  MIN_WINDOW_ZOOM_LEVEL,
} from "./contracts/preferences.ts";

export function clampWindowZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return DEFAULT_WINDOW_ZOOM_LEVEL;
  }
  return Math.min(
    MAX_WINDOW_ZOOM_LEVEL,
    Math.max(MIN_WINDOW_ZOOM_LEVEL, Math.trunc(level))
  );
}

export function windowZoomFactor(level: number): number {
  return 1.2 ** clampWindowZoomLevel(level);
}

export function effectiveTerminalFontSize(
  baseSize: number,
  windowZoomLevel: number
): number {
  const scaled = baseSize * windowZoomFactor(windowZoomLevel);
  const rounded = Math.round(scaled * 10) / 10;
  return Math.min(48, Math.max(8, rounded));
}
