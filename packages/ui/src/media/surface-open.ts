/**
 * Shared guard for "click anywhere on the card opens fullscreen" surfaces
 * (mermaid scene cards, markdown diagrams). A plain click is one that does
 * not land on an interactive element and does not finish a text selection.
 */
const INTERACTIVE_SURFACE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [data-no-fullscreen]";

export function isPlainSurfaceClick(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el?.closest(INTERACTIVE_SURFACE_SELECTOR)) {
    return false;
  }
  // mouseup after a drag-select fires click; never treat that as open.
  if (window.getSelection()?.isCollapsed === false) {
    return false;
  }
  return true;
}
