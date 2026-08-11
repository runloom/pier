/**
 * Design Mode–style element pick for canvas comments (Orca-like).
 * Click a live DOM node in the preview host → snapshot for createThread.
 * Optional data-pier-comment-id improves re-locate after hot reload.
 */
import {
  CANVAS_COMMENT_ANCHOR_ATTR,
  findCanvasCommentAnchorElement,
} from "@shared/comments/canvas-anchor.ts";

export interface CanvasElementPick {
  /** Declared stable id when present on the node or an ancestor. */
  readonly anchorId?: string;
  readonly excerpt: string;
  readonly label: string;
}

const SKIP_CLOSEST =
  "[data-slot='canvas-comment-overlay'],[data-slot='canvas-comment-pick-chrome'],[data-canvas-comment-badge]";

function normalizeText(value: string | null | undefined, max: number): string {
  const collapsed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    return "";
  }
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`;
}

function isIgnorableTarget(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) {
    return true;
  }
  if (node.closest(SKIP_CLOSEST)) {
    return true;
  }
  return false;
}

/**
 * Walk from the event target up to host (exclusive of host) and pick the
 * best annotation target: prefer an ancestor with data-pier-comment-id,
 * else the deepest interactive / labeled element, else the deepest element.
 */
export function resolveCanvasElementPick(
  host: HTMLElement,
  event: MouseEvent
): CanvasElementPick | null {
  if (isIgnorableTarget(event.target)) {
    return null;
  }
  const path: HTMLElement[] = [];
  let current: Element | null =
    event.target instanceof Element ? event.target : null;
  while (current && current !== host) {
    if (current instanceof HTMLElement) {
      path.push(current);
    }
    current = current.parentElement;
  }
  if (path.length === 0 || !host.contains(path[0] ?? null)) {
    return null;
  }

  let withAnchor: HTMLElement | null = null;
  for (const el of path) {
    const id = el.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim();
    if (id) {
      withAnchor = el;
      break;
    }
  }

  const interactive = path.find(
    (el) =>
      el.matches(
        "button,a,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']"
      ) || el.tabIndex >= 0
  );

  const target = withAnchor ?? interactive ?? path[0] ?? null;
  if (!target) {
    return null;
  }

  const anchorId =
    target.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim() || undefined;
  const aria = target.getAttribute("aria-label")?.trim();
  const text = normalizeText(target.textContent, 80);
  const tag = target.tagName.toLowerCase();
  const label = normalizeText(aria, 80) || text || (anchorId ? anchorId : tag);
  const excerpt =
    normalizeText(aria ? `${aria}${text ? ` — ${text}` : ""}` : text, 500) ||
    label;

  return {
    excerpt: excerpt.length > 0 ? excerpt : "…",
    label: label.length > 0 ? label : tag,
    ...(anchorId ? { anchorId } : {}),
  };
}

/** Apply/remove a temporary outline for pick hover. */
export function setCanvasPickHighlight(
  host: HTMLElement,
  element: HTMLElement | null
): void {
  const previous = host.querySelectorAll("[data-pier-canvas-pick-highlight]");
  for (const node of previous) {
    node.removeAttribute("data-pier-canvas-pick-highlight");
    if (node instanceof HTMLElement) {
      node.style.outline = "";
      node.style.outlineOffset = "";
    }
  }
  if (!(element && host.contains(element))) {
    return;
  }
  element.setAttribute("data-pier-canvas-pick-highlight", "");
  element.style.outline = "2px solid var(--action-accent, #3b82f6)";
  element.style.outlineOffset = "2px";
}

export function clearCanvasPickHighlight(host: HTMLElement): void {
  setCanvasPickHighlight(host, null);
}

export function scrollCanvasPickIntoView(
  host: HTMLElement,
  pick: CanvasElementPick
): void {
  if (pick.anchorId) {
    const el = findCanvasCommentAnchorElement(host, pick.anchorId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
