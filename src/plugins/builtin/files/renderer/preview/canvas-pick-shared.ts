/**
 * Shared types and helpers for Design Mode canvas pick.
 */
export interface CanvasElementPick {
  /** Declared stable id when present on the node or an ancestor. */
  readonly anchorId?: string;
  readonly excerpt: string;
  readonly label: string;
}

/** Rect in shell content coordinates (includes shell scroll). */
export interface CanvasPickOverlayBox {
  readonly height: number;
  readonly label: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** Hit chain: index 0 = deepest under cursor; higher = ancestors toward host. */
export interface CanvasPickChain {
  readonly chain: readonly HTMLElement[];
  readonly defaultDepth: number;
  readonly leaf: HTMLElement;
}

export const SKIP_CLOSEST =
  "[data-slot='canvas-comment-overlay'],[data-slot='canvas-comment-pick-chrome'],[data-slot='canvas-comment-pick-layer'],[data-canvas-comment-badge],[data-pier-canvas-pick-box]";

export const INTERACTIVE_SELECTOR =
  "button,a,input,textarea,select,label,summary,[role='button'],[role='link'],[role='checkbox'],[role='menuitem'],[role='tab'],[contenteditable='true']";

export function normalizeCanvasPickText(
  value: string | null | undefined,
  max: number
): string {
  const collapsed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    return "";
  }
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`;
}

export function isIgnorableCanvasPickTarget(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) {
    return true;
  }
  if (node.closest(SKIP_CLOSEST)) {
    return true;
  }
  return false;
}

/**
 * Resolve an Element (incl. SVG) to the nearest painted HTMLElement under host.
 * Never returns host itself. 0×0 wrappers walk up (jsdom-friendly fallback kept).
 */
export function resolveHtmlUnderHost(
  host: HTMLElement,
  start: Element
): HTMLElement | null {
  if (!(host === start || host.contains(start)) || start === host) {
    return null;
  }
  let current: Element | null = start;
  let fallback: HTMLElement | null = null;
  while (current && current !== host) {
    if (
      current instanceof HTMLElement &&
      !isIgnorableCanvasPickTarget(current)
    ) {
      fallback ??= current;
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return fallback;
}

export function pointInClientRect(
  clientX: number,
  clientY: number,
  rect: DOMRect
): boolean {
  return (
    clientX >= rect.left &&
    clientX < rect.right &&
    clientY >= rect.top &&
    clientY < rect.bottom
  );
}
