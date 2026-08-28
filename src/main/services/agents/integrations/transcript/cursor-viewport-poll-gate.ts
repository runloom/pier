/** Main-side gate so Cursor viewport dumps yield during live window resize. */

export const CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS = 1000;

const pausedWindowIds = new Set<number>();
const fallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearFallback(windowId: number): void {
  const timer = fallbackTimers.get(windowId);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  fallbackTimers.delete(windowId);
}

export function setCursorViewportResizePollPaused(
  windowId: number,
  paused: boolean
): void {
  if (paused) {
    pausedWindowIds.add(windowId);
    clearFallback(windowId);
    const timer = setTimeout(() => {
      fallbackTimers.delete(windowId);
      pausedWindowIds.delete(windowId);
    }, CURSOR_VIEWPORT_RESIZE_POLL_FALLBACK_MS);
    timer.unref?.();
    fallbackTimers.set(windowId, timer);
    return;
  }
  pausedWindowIds.delete(windowId);
  clearFallback(windowId);
}

export function isCursorViewportPollPaused(): boolean {
  return pausedWindowIds.size > 0;
}

export function resetCursorViewportPollGateForTests(): void {
  for (const windowId of [...pausedWindowIds]) {
    setCursorViewportResizePollPaused(windowId, false);
  }
}
