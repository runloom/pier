/**
 * Pick chain build + target promotion (leaf-first with limited promote).
 */
import { CANVAS_COMMENT_ANCHOR_ATTR } from "@shared/comments/canvas-anchor.ts";
import {
  type CanvasElementPick,
  type CanvasPickChain,
  INTERACTIVE_SELECTOR,
  isIgnorableCanvasPickTarget,
  normalizeCanvasPickText,
} from "./canvas-pick-shared.ts";

export type { CanvasPickChain } from "./canvas-pick-shared.ts";

/** Build leaf→ancestor chain (exclusive of host). */
export function buildCanvasPickChain(
  host: HTMLElement,
  leaf: HTMLElement
): CanvasPickChain | null {
  if (!(host.contains(leaf) && leaf !== host)) {
    return null;
  }
  const chain: HTMLElement[] = [];
  let current: Element | null = leaf;
  while (current && current !== host) {
    if (current instanceof HTMLElement) {
      chain.push(current);
    }
    current = current.parentElement;
  }
  if (chain.length === 0) {
    return null;
  }
  return {
    chain,
    defaultDepth: defaultPickDepth(host, chain),
    leaf: chain[0] ?? leaf,
  };
}

/**
 * Default depth (0 = deepest under cursor).
 *
 * Industry default (DevTools / Orca Design Mode): pick what is under the
 * cursor (leaf), with only a few automatic promotions:
 * - declared anchor id
 * - span/icon → nearby button/tab (≤2 ancestors)
 * - inner svg/canvas host → outer mermaid/product surface
 *
 * We deliberately do NOT auto-promote to Card/Item shells: that made badges,
 * titles, and body text feel "unselectable" (everything snapped to the whole
 * card). Promotion never returns out-of-range; leaf is always valid.
 */
export function defaultPickDepth(
  _host: HTMLElement,
  chain: readonly HTMLElement[]
): number {
  if (chain.length === 0) {
    return 0;
  }

  for (let i = 0; i < chain.length; i++) {
    const el = chain[i];
    if (el?.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim()) {
      return i;
    }
  }

  const leaf = chain[0];
  if (leaf && !(leaf.matches(INTERACTIVE_SELECTOR) || leaf.tabIndex >= 0)) {
    for (let i = 1; i < Math.min(chain.length, 3); i++) {
      const el = chain[i];
      if (!el) {
        continue;
      }
      if (el.matches(INTERACTIVE_SELECTOR) || el.tabIndex >= 0) {
        if (el.closest("[data-slot='mermaid-diagram']")) {
          const surface = chain.findIndex((node) =>
            isPreferableProductSurface(node)
          );
          if (surface >= 0) {
            return surface;
          }
        }
        return i;
      }
    }
  }

  if (leaf && isInnerMediaHost(leaf)) {
    const surface = chain.findIndex((node) => isPreferableProductSurface(node));
    if (surface >= 0) {
      return surface;
    }
  }

  // Deepest node under the cursor (industry default).
  return 0;
}

function isInnerMediaHost(el: HTMLElement): boolean {
  const slot = el.getAttribute("data-slot")?.trim() ?? "";
  if (
    slot.endsWith("-svg") ||
    slot.endsWith("-canvas") ||
    slot.endsWith("-host")
  ) {
    return true;
  }
  const tag = el.tagName.toLowerCase();
  return tag === "svg" || tag === "canvas";
}

/** Outer product chrome users expect to annotate (not inner svg/canvas hosts). */
function isPreferableProductSurface(el: HTMLElement): boolean {
  const slot = el.getAttribute("data-slot")?.trim() ?? "";
  if (slot === "mermaid-diagram") {
    return true;
  }
  if (
    slot.endsWith("-svg") ||
    slot.endsWith("-canvas") ||
    slot.endsWith("-host")
  ) {
    return false;
  }
  if (el.getAttribute("role") === "img" && slot.length > 0) {
    return true;
  }
  return false;
}

export function clampPickDepth(
  chain: readonly HTMLElement[],
  depth: number
): number {
  if (chain.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(chain.length - 1, depth));
}

/** Snapshot pick fields from a concrete element (+ optional chain for anchor walk). */
export function snapshotCanvasElementPick(
  host: HTMLElement,
  target: HTMLElement,
  chain?: readonly HTMLElement[]
): CanvasElementPick {
  const walk = chain ?? buildCanvasPickChain(host, target)?.chain ?? [target];
  const anchorId =
    target.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim() ||
    walk
      .map((el) => el.getAttribute(CANVAS_COMMENT_ANCHOR_ATTR)?.trim())
      .find((id) => id && id.length > 0) ||
    undefined;
  const aria = target.getAttribute("aria-label")?.trim();
  const text = normalizeCanvasPickText(target.textContent, 80);
  const tag = target.tagName.toLowerCase();
  const label =
    normalizeCanvasPickText(aria, 80) || text || (anchorId ? anchorId : tag);
  const excerpt =
    normalizeCanvasPickText(
      aria ? `${aria}${text ? ` — ${text}` : ""}` : text,
      500
    ) || label;
  return {
    excerpt: excerpt.length > 0 ? excerpt : "…",
    label: label.length > 0 ? label : tag,
    ...(anchorId ? { anchorId } : {}),
  };
}

/**
 * Walk from a host-descendant and pick with default depth heuristics.
 */
export function pickFromCanvasElement(
  host: HTMLElement,
  start: Element | null
): CanvasElementPick | null {
  if (!(start instanceof HTMLElement) || isIgnorableCanvasPickTarget(start)) {
    return null;
  }
  const built = buildCanvasPickChain(host, start);
  if (!built) {
    return null;
  }
  const el = built.chain[built.defaultDepth] ?? built.leaf;
  return snapshotCanvasElementPick(host, el, built.chain);
}

/**
 * Resolve pick from a mouse event whose target is under the host
 * (legacy / tests). Prefer hitTest + pick layer in UI.
 */
export function resolveCanvasElementPick(
  host: HTMLElement,
  event: MouseEvent
): CanvasElementPick | null {
  if (isIgnorableCanvasPickTarget(event.target)) {
    return null;
  }
  const start = event.target instanceof Element ? event.target : null;
  return pickFromCanvasElement(host, start);
}
