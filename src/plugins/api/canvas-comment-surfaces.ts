/**
 * Host ↔ files plugin bus for open canvas comment projection surfaces.
 * Processable reads this so open previews can mark canvas threads located/stale/soft.
 * Lives in plugins/api so builtin plugins never import src/renderer.
 *
 * Store is attached to globalThis so host + plugin chunks never split into two Maps.
 */
import type { CanvasCommentSurface } from "@shared/comments/canvas-surface.ts";

export type { CanvasCommentSurface } from "@shared/comments/canvas-surface.ts";

const GLOBAL_KEY = "__pierCanvasCommentSurfacesV1__";

interface SurfaceBus {
  listeners: Set<() => void>;
  /** Monotonic epoch — bumps on every set/clear so consumers always re-read. */
  revision: number;
  surfacesByPath: Map<string, CanvasCommentSurface>;
}

function getBus(): SurfaceBus {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: SurfaceBus;
  };
  let bus = globalRef[GLOBAL_KEY];
  if (!bus) {
    bus = {
      listeners: new Set(),
      revision: 0,
      surfacesByPath: new Map(),
    };
    globalRef[GLOBAL_KEY] = bus;
  }
  return bus;
}

function notify(): void {
  const bus = getBus();
  bus.revision += 1;
  for (const listener of bus.listeners) {
    try {
      listener();
    } catch {
      // Listeners must not break publishers.
    }
  }
}

/**
 * Normalize canvas path keys so surface lookup matches stored thread targets.
 * - POSIX slashes
 * - strip leading `./`
 */
export function normalizeCanvasCommentSurfacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** Publish (or replace) the surface for a project-relative canvas path. */
export function setCanvasCommentSurface(
  path: string,
  surface: CanvasCommentSurface
): void {
  const key = normalizeCanvasCommentSurfacePath(path);
  if (key.length === 0) {
    return;
  }
  getBus().surfacesByPath.set(key, surface);
  notify();
}

/** Drop the surface when a canvas preview unmounts. */
export function clearCanvasCommentSurface(path: string): void {
  const key = normalizeCanvasCommentSurfacePath(path);
  const bus = getBus();
  if (!bus.surfacesByPath.has(key)) {
    return;
  }
  bus.surfacesByPath.delete(key);
  notify();
}

/** Snapshot of all open-preview surfaces (for processable). */
export function getCanvasCommentSurfaces(): ReadonlyMap<
  string,
  CanvasCommentSurface
> {
  return new Map(getBus().surfacesByPath);
}

/** Monotonic bus epoch for useSyncExternalStore. */
export function getCanvasCommentSurfacesRevision(): number {
  return getBus().revision;
}

export function onCanvasCommentSurfacesChanged(
  listener: () => void
): () => void {
  const bus = getBus();
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}

/** @internal test helper */
export function resetCanvasCommentSurfacesForTests(): void {
  const bus = getBus();
  bus.surfacesByPath.clear();
  bus.revision = 0;
  bus.listeners.clear();
}
