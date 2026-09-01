/**
 * Per-canvas world-camera memory (board view pan/zoom).
 * Fit is re-computed on restore; free poses restore look-at (world center + scale).
 * Hand-written localStorage, same family as markdown scroll-memory.
 */
import { MAX_ZOOM, MIN_ZOOM } from "@pier/ui/image-preview/canvas-math.ts";

export const CANVAS_WORLD_CAMERA_STORAGE_PREFIX =
  "pier.files.canvas.worldCamera:";

export const CANVAS_WORLD_CAMERA_MEMORY_VERSION = 1;

export type CanvasWorldCameraMemory =
  | { readonly v: 1; readonly mode: "fit" }
  | {
      readonly v: 1;
      readonly mode: "free";
      readonly scale: number;
      readonly worldX: number;
      readonly worldY: number;
    };

export function canvasWorldCameraStorageKey(
  root: string,
  path: string
): string {
  return `${CANVAS_WORLD_CAMERA_STORAGE_PREFIX}${root}::${path}`;
}

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseCanvasWorldCameraMemory(
  raw: unknown
): CanvasWorldCameraMemory | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as {
    mode?: unknown;
    scale?: unknown;
    v?: unknown;
    worldX?: unknown;
    worldY?: unknown;
  };
  if (record.v !== CANVAS_WORLD_CAMERA_MEMORY_VERSION) {
    return null;
  }
  if (record.mode === "fit") {
    return { mode: "fit", v: 1 };
  }
  if (
    record.mode === "free" &&
    isFiniteNumber(record.worldX) &&
    isFiniteNumber(record.worldY) &&
    isFiniteNumber(record.scale) &&
    record.scale >= MIN_ZOOM &&
    record.scale <= MAX_ZOOM
  ) {
    return {
      mode: "free",
      scale: record.scale,
      v: 1,
      worldX: record.worldX,
      worldY: record.worldY,
    };
  }
  return null;
}

export function rememberCanvasWorldCamera(
  key: string,
  memory: CanvasWorldCameraMemory
): void {
  if (key.length === 0) {
    return;
  }
  try {
    preferenceStorage()?.setItem(key, JSON.stringify(memory));
  } catch {
    // Storage unavailable/quota: viewing pose degrades to session-only.
  }
}

export function recallCanvasWorldCamera(
  key: string
): CanvasWorldCameraMemory | null {
  if (key.length === 0) {
    return null;
  }
  try {
    const raw = preferenceStorage()?.getItem(key);
    if (!raw) {
      return null;
    }
    return parseCanvasWorldCameraMemory(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
