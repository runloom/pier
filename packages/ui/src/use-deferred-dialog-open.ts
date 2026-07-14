import { useEffect, useState } from "react";
import {
  isOverlayBlockingDialogOpen,
  scheduleAfterOverlay,
} from "./schedule-after-overlay.ts";

export interface DeferredDialogOpenOptions {
  /**
   * Fired when a deferred open is abandoned because the overlay/body lock did
   * not clear in time. The dialog stays closed; callers may reset product state.
   */
  onAbandon?: () => void;
}

/**
 * Controlled Dialog/AlertDialog open state.
 *
 * - Close is always synchronous (render path).
 * - Open is synchronous when no overlay is active.
 * - Open is deferred until overlay dismiss / body unlock when a menu/select is
 *   still mounted or body pointer-events are locked.
 * - If still blocked after the wait budget, open is abandoned (not force-opened).
 * - Setting `open` back to false cancels any pending deferred open.
 *
 * Product code keeps normal controlled state — no modal={false} or manual
 * scheduleAfterOverlay at call sites.
 */
export function useDeferredDialogOpen(
  open: boolean | undefined,
  options: DeferredDialogOpenOptions = {}
): boolean | undefined {
  const [renderedOpen, setRenderedOpen] = useState(() => open === true);

  // Keep the no-conflict open path on the render tree: if the desired state is
  // open and nothing blocks, return true immediately without waiting for effect.
  const effectiveOpen =
    open === true && !renderedOpen && !isOverlayBlockingDialogOpen()
      ? true
      : renderedOpen;

  useEffect(() => {
    if (open === undefined) {
      return;
    }
    if (!open) {
      setRenderedOpen(false);
      return;
    }
    if (!isOverlayBlockingDialogOpen()) {
      setRenderedOpen(true);
      return;
    }
    return scheduleAfterOverlay(
      () => {
        setRenderedOpen(true);
      },
      {
        onAbandon: () => {
          setRenderedOpen(false);
          options.onAbandon?.();
        },
      }
    );
  }, [open, options.onAbandon]);

  if (open === undefined) {
    return;
  }
  if (!open) {
    return false;
  }
  return effectiveOpen;
}
