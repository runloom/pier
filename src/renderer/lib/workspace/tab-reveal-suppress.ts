/**
 * Temporarily suppress automatic tab-strip reveal (group focus / maximize
 * follow-ups). Used by native terminal content focus so clicking the surface
 * does not jump the tab strip while restoring input routing.
 */

let suppressDepth = 0;

export function withSuppressedTabReveal<T>(fn: () => T): T {
  suppressDepth += 1;
  try {
    return fn();
  } finally {
    suppressDepth -= 1;
  }
}

export function isTabRevealSuppressed(): boolean {
  return suppressDepth > 0;
}
