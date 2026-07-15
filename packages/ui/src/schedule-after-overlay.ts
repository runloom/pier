import { OPEN_MODAL_CONTENT_SELECTOR } from "./modal-layer.ts";

/**
 * Open Radix portals that currently own modal pointer-events / focus.
 * Present when a menu/select is still mounted in the same turn a Dialog opens.
 *
 * Intentionally excludes dialog / alert-dialog content: an already-open modal
 * (settings, host confirm shell) also sets body pointer-events=none, and nested
 * dialogs opened from inside it must not wait for that lock to clear.
 */
export const OPEN_OVERLAY_SELECTOR = [
  "[data-slot=select-content]",
  "[data-slot=popover-content]",
  "[data-slot=dropdown-menu-content]",
  "[data-slot=context-menu-content]",
  "[data-slot=menubar-content]",
  "[data-slot=hover-card-content]",
  "[data-slot=combobox-content]",
  "[role=listbox]",
  "[role=menu]",
].join(",");

const OPEN_MODAL_SHELL_SELECTOR = OPEN_MODAL_CONTENT_SELECTOR;

const MAX_WAIT_MS = 1000;
const POLL_MS = 16;

export function isOverlayBlockingDialogOpen(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  // Menus/selects always block — even when a parent dialog is open.
  if (document.querySelector(OPEN_OVERLAY_SELECTOR)) {
    return true;
  }
  // Radix modal menus lock body while closing. An already-open dialog also
  // leaves body pointer-events=none; that lock alone must not block nested opens.
  if (document.body.style.pointerEvents !== "none") {
    return false;
  }
  return document.querySelector(OPEN_MODAL_SHELL_SELECTOR) === null;
}

export interface ScheduleAfterOverlayOptions {
  /**
   * Called when the wait budget is exhausted while an overlay/body lock is
   * still present. The task is intentionally NOT force-run in that case.
   */
  onAbandon?: () => void;
}

/**
 * Run work after the current Radix overlay has finished its close + body
 * pointer-events unlock cycle.
 *
 * - If nothing is blocking, schedules a single macrotask (lets React flush).
 * - If a menu/select is still mounted or body is pointer-events locked, polls
 *   until clear.
 * - If still blocked after MAX_WAIT_MS, abandons (does not force-run) and
 *   invokes `onAbandon` when provided.
 *
 * Returns a cancel function for unmount / superseded opens.
 */
export function scheduleAfterOverlay(
  task: () => void,
  options: ScheduleAfterOverlayOptions = {}
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const startedAt = Date.now();

  const clearTimer = (): void => {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
  };

  const run = (): void => {
    if (cancelled) {
      return;
    }
    if (isOverlayBlockingDialogOpen()) {
      if (Date.now() - startedAt < MAX_WAIT_MS) {
        timer = globalThis.setTimeout(run, POLL_MS);
        return;
      }
      options.onAbandon?.();
      return;
    }
    task();
  };

  timer = globalThis.setTimeout(run, 0);

  return () => {
    cancelled = true;
    clearTimer();
  };
}
