/**
 * Session soft-pin store for canvas comments without declared anchorId.
 * Survives preview remount within the same renderer session (path-keyed).
 *
 * Store is attached to globalThis so host + plugin chunks never split into two Maps
 * (same pattern as canvas-comment-surfaces).
 */
import { normalizeCanvasCommentSurfacePath } from "@plugins/api/canvas-comment-surfaces.ts";

export interface CanvasSoftMarker {
  readonly label: string;
  readonly left: number;
  readonly threadId: string;
  readonly top: number;
}

const GLOBAL_KEY = "__pierCanvasSoftMarkersV1__";

interface SoftMarkerBus {
  markersByPath: Map<string, CanvasSoftMarker[]>;
}

function getBus(): SoftMarkerBus {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: SoftMarkerBus;
  };
  let bus = globalRef[GLOBAL_KEY];
  if (!bus) {
    bus = { markersByPath: new Map() };
    globalRef[GLOBAL_KEY] = bus;
  }
  return bus;
}

function pathKey(path: string): string {
  return normalizeCanvasCommentSurfacePath(path);
}

export function getCanvasSoftMarkers(
  path: string
): readonly CanvasSoftMarker[] {
  const key = pathKey(path);
  if (key.length === 0) {
    return [];
  }
  return getBus().markersByPath.get(key) ?? [];
}

export function upsertCanvasSoftMarker(
  path: string,
  marker: CanvasSoftMarker
): readonly CanvasSoftMarker[] {
  const key = pathKey(path);
  if (key.length === 0) {
    return [];
  }
  const bus = getBus();
  const prev = bus.markersByPath.get(key) ?? [];
  const next = [
    ...prev.filter((item) => item.threadId !== marker.threadId),
    marker,
  ];
  bus.markersByPath.set(key, next);
  return next;
}

export function pruneCanvasSoftMarkers(
  path: string,
  liveThreadIds: ReadonlySet<string>
): readonly CanvasSoftMarker[] {
  const key = pathKey(path);
  if (key.length === 0) {
    return [];
  }
  const bus = getBus();
  const prev = bus.markersByPath.get(key) ?? [];
  const next = prev.filter((marker) => liveThreadIds.has(marker.threadId));
  if (next.length === 0) {
    bus.markersByPath.delete(key);
    return [];
  }
  bus.markersByPath.set(key, next);
  return next;
}

export function clearCanvasSoftMarkers(path: string): void {
  const key = pathKey(path);
  if (key.length === 0) {
    return;
  }
  getBus().markersByPath.delete(key);
}
