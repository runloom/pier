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
  "[data-slot='canvas-comment-overlay'],[data-slot='canvas-comment-pick-chrome'],[data-slot='canvas-comment-pick-layer'],[data-canvas-comment-badge],[data-slot='comment-count-badge'],[data-slot='comment-hover-preview'],[data-slot='hover-card-content'],[data-slot='popover-content'],[data-pier-canvas-pick-box]";

/** Pin / floater chrome — pick mode must not steal hover or click from these. */
export const CANVAS_COMMENT_CHROME_HIT =
  "[data-canvas-comment-pin],[data-slot='comment-count-badge'],[data-slot='comment-hover-preview'],[data-slot='hover-card-content'],[data-slot='popover-content']";

export function isCanvasCommentChromePointerEvent(event: Event): boolean {
  const nodes =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  const targets = nodes.length > 0 ? nodes : [event.target];
  for (const node of targets) {
    if (node instanceof Element && node.closest(CANVAS_COMMENT_CHROME_HIT)) {
      return true;
    }
  }
  return false;
}

export const INTERACTIVE_SELECTOR =
  "button,a,input,textarea,select,label,summary,[role='button'],[role='link'],[role='checkbox'],[role='menuitem'],[role='tab'],[contenteditable='true']";

/** Copy the user is aiming at — never promote these to a page/tab shell. */
export const COPY_LEAF_SELECTOR =
  "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd";

export function isTabPanelLike(el: HTMLElement): boolean {
  return (
    el.getAttribute("role") === "tabpanel" ||
    el.getAttribute("data-slot") === "tabs-content"
  );
}

const ARTBOARD_FRAME_SLOT = "artboard-frame";
/** Fill ratio vs the Artboard frame that counts as the whole phone, not a widget. */
const FRAME_SHELL_AREA_RATIO = 0.9;

/**
 * Declared `data-pier-comment-id` on an Artboard-filling shell is for pinning
 * comments on that frame — it must not steal Design Mode picks from inner
 * controls. Tight regions (hero card, heading, button) are not shells.
 */
export function isCanvasFrameShellAnchor(el: HTMLElement): boolean {
  const slot = el.getAttribute("data-slot")?.trim() ?? "";
  if (slot === "artboard" || slot === ARTBOARD_FRAME_SLOT) {
    return true;
  }
  const parent = el.parentElement;
  if (parent?.getAttribute("data-slot")?.trim() === ARTBOARD_FRAME_SLOT) {
    return true;
  }
  const frame = el.closest(`[data-slot='${ARTBOARD_FRAME_SLOT}']`);
  if (!(frame instanceof HTMLElement) || frame === el) {
    return false;
  }
  const frameRect = frame.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (
    !(
      frameRect.width > 0 &&
      frameRect.height > 0 &&
      elRect.width > 0 &&
      elRect.height > 0
    )
  ) {
    return false;
  }
  const ratio =
    (elRect.width * elRect.height) / (frameRect.width * frameRect.height);
  return ratio >= FRAME_SHELL_AREA_RATIO;
}

export function isCanvasTabTrigger(el: HTMLElement): boolean {
  return (
    el.getAttribute("role") === "tab" ||
    el.getAttribute("data-slot") === "tabs-trigger"
  );
}

/**
 * Hide pins whose target lives in an inactive TabsContent.
 * Tab triggers stay eligible — the tab bar is always on screen.
 */
export function isCanvasCommentTargetVisible(el: HTMLElement): boolean {
  const panel = el.closest("[data-slot='tabs-content'],[role='tabpanel']");
  if (!(panel instanceof HTMLElement)) {
    return true;
  }
  return !(
    panel.getAttribute("data-state") === "inactive" ||
    panel.hasAttribute("hidden")
  );
}

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

/**
 * Strip the display ellipsis from a stored pick label so rematch can compare
 * against live text (which never contains the truncation mark).
 */
export function canvasPickLabelStem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith("…")) {
    return trimmed.slice(0, -1).trimEnd();
  }
  if (trimmed.endsWith("...")) {
    return trimmed.slice(0, -3).trimEnd();
  }
  return trimmed;
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
