/**
 * Temporarily suppress automatic tab-strip reveal (group focus / maximize
 * follow-ups). Used by native terminal content focus so clicking the surface
 * does not jump the tab strip while restoring input routing.
 */

let suppressDepth = 0;
let interactionLatch = false;
let interactionLatchTimer: ReturnType<typeof setTimeout> | null = null;

export function withSuppressedTabReveal<T>(fn: () => T): T {
  suppressDepth += 1;
  try {
    return fn();
  } finally {
    suppressDepth -= 1;
  }
}

/**
 * Suppress reveal for the rest of the current input turn. Web-landing clicks
 * on panel CONTENT focus the container (tabIndex=-1) → dockview activates the
 * group synchronously; that activation must not yank the tab strip. Tab-strip
 * clicks, keyboard navigation, and explicit reveal:"always" paths never latch.
 */
export function suppressTabRevealForCurrentInteraction(): void {
  interactionLatch = true;
  if (interactionLatchTimer !== null) {
    clearTimeout(interactionLatchTimer);
  }
  interactionLatchTimer = setTimeout(() => {
    interactionLatch = false;
    interactionLatchTimer = null;
  }, 0);
}

export function isTabRevealSuppressed(): boolean {
  return suppressDepth > 0 || interactionLatch;
}

export function resetTabRevealSuppressionForTests(): void {
  suppressDepth = 0;
  interactionLatch = false;
  if (interactionLatchTimer !== null) {
    clearTimeout(interactionLatchTimer);
    interactionLatchTimer = null;
  }
}
