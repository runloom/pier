/**
 * Host ↔ files plugin bus for open markdown comment projection surfaces.
 * Processable reads this so open previews can mark markdown threads located/stale.
 * Lives in plugins/api so builtin plugins never import src/renderer.
 *
 * Store is attached to globalThis so host + plugin chunks never split into two Maps.
 */
import type { MarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";

export type { MarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";

const GLOBAL_KEY = "__pierMarkdownCommentSurfacesV1__";

interface SurfaceBus {
  listeners: Set<() => void>;
  /** Monotonic epoch — bumps on every set/clear so consumers always re-read. */
  revision: number;
  surfacesByPath: Map<string, MarkdownCommentSurface>;
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
 * Normalize markdown path keys so surface lookup matches stored thread targets.
 * - POSIX slashes
 * - strip leading `./`
 */
function normalizeMarkdownCommentSurfacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** Publish (or replace) the surface for a project-relative markdown path. */
export function setMarkdownCommentSurface(
  path: string,
  surface: MarkdownCommentSurface
): void {
  const key = normalizeMarkdownCommentSurfacePath(path);
  getBus().surfacesByPath.set(key, surface);
  notify();
}

/** Drop the surface when a markdown preview unmounts. */
export function clearMarkdownCommentSurface(path: string): void {
  const key = normalizeMarkdownCommentSurfacePath(path);
  const bus = getBus();
  if (!bus.surfacesByPath.has(key)) {
    return;
  }
  bus.surfacesByPath.delete(key);
  notify();
}

/** Snapshot of all open-preview surfaces (for processable). */
export function getMarkdownCommentSurfaces(): ReadonlyMap<
  string,
  MarkdownCommentSurface
> {
  return new Map(getBus().surfacesByPath);
}

/** Monotonic bus epoch for useSyncExternalStore. */
export function getMarkdownCommentSurfacesRevision(): number {
  return getBus().revision;
}

export function onMarkdownCommentSurfacesChanged(
  listener: () => void
): () => void {
  const bus = getBus();
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}

/** @internal test helper */
export function resetMarkdownCommentSurfacesForTests(): void {
  const bus = getBus();
  bus.surfacesByPath.clear();
  bus.revision = 0;
  bus.listeners.clear();
}
