/**
 * Open modal shells currently mounted via Dialog / AlertDialog portals.
 * Later nodes are higher in the stack (portals append to document body).
 */
export const OPEN_MODAL_CONTENT_SELECTOR = [
  "[data-slot=dialog-content]",
  "[data-slot=alert-dialog-content]",
].join(",");

/**
 * True when `target` is (or is inside) the topmost open modal content, or when
 * no modal content is present. Used so Escape only dismisses the top layer.
 */
export function isTopmostModalContent(target: EventTarget | null): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  if (!(target instanceof Element)) {
    return true;
  }
  const content = target.closest(OPEN_MODAL_CONTENT_SELECTOR);
  if (!content) {
    return true;
  }
  const open = document.querySelectorAll(OPEN_MODAL_CONTENT_SELECTOR);
  if (open.length === 0) {
    return true;
  }
  return open.item(open.length - 1) === content;
}
