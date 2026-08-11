/**
 * Host ↔ files plugin bus for open canvas comment projection surfaces.
 * Processable reads this so open previews can mark canvas threads located/stale.
 * Lives in plugins/api so builtin plugins never import src/renderer.
 */
import type { CanvasCommentSurface } from "@shared/comments/canvas-surface.ts";

export type { CanvasCommentSurface } from "@shared/comments/canvas-surface.ts";

const surfacesByPath = new Map<string, CanvasCommentSurface>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listeners must not break publishers.
    }
  }
}

/** Publish (or replace) the surface for a project-relative canvas path. */
export function setCanvasCommentSurface(
  path: string,
  surface: CanvasCommentSurface
): void {
  surfacesByPath.set(path, surface);
  notify();
}

/** Drop the surface when a canvas preview unmounts. */
export function clearCanvasCommentSurface(path: string): void {
  if (!surfacesByPath.has(path)) {
    return;
  }
  surfacesByPath.delete(path);
  notify();
}

/** Snapshot of all open-preview surfaces (for processable). */
export function getCanvasCommentSurfaces(): ReadonlyMap<
  string,
  CanvasCommentSurface
> {
  return new Map(surfacesByPath);
}

export function onCanvasCommentSurfacesChanged(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal test helper */
export function resetCanvasCommentSurfacesForTests(): void {
  surfacesByPath.clear();
  listeners.clear();
}
