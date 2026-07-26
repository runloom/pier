import { type RefObject, useEffect } from "react";

/**
 * Overlays that must own Escape before the in-file find bar closes.
 * Includes portaled Radix dialogs/menus and host dialog slots.
 */
const ESCAPE_DEFER_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
].join(", ");

function isInsideEscapeDeferredOverlay(
  node: EventTarget | null
): node is Element {
  return (
    node instanceof Element &&
    Boolean(node.closest(ESCAPE_DEFER_OVERLAY_SELECTOR))
  );
}

/**
 * Close the in-file find bar on Escape even when focus is not in the search input
 * (e.g. focus returned to the editor / preview surface).
 *
 * Scoped to events whose target or active element lies within `surfaceRef`, so
 * global dialogs / other panels keep their own Escape handling.
 */
export function useFilesInFileSearchEscape(
  open: boolean,
  onClose: () => void,
  surfaceRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing
      ) {
        return;
      }
      const surface = surfaceRef.current;
      if (!surface) {
        return;
      }

      const target = event.target instanceof Node ? event.target : null;
      const active = document.activeElement;
      const inside =
        (target !== null && surface.contains(target)) ||
        (active instanceof Node && surface.contains(active));
      if (!inside) {
        return;
      }

      // Nested modal / menu / listbox wins Escape (including portaled focus).
      if (
        isInsideEscapeDeferredOverlay(active) ||
        isInsideEscapeDeferredOverlay(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, open, surfaceRef]);
}
