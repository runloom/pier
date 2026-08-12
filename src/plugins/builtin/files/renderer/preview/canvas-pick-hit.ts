/**
 * Point hit-test for Design Mode (composedPath → elementsFromPoint → geometry).
 */

import {
  buildCanvasPickChain,
  type CanvasPickChain,
  snapshotCanvasElementPick,
} from "./canvas-pick-promote.ts";
import type { CanvasElementPick } from "./canvas-pick-shared.ts";
import {
  isIgnorableCanvasPickTarget,
  pointInClientRect,
  resolveHtmlUnderHost,
} from "./canvas-pick-shared.ts";

/**
 * Geometry fallback: smallest visible host descendant whose box contains the
 * point. Guarantees pickability when browser hit-test misses (stack empty,
 * pointer-events quirks). Still returns a real DOM node — not screenshot pins.
 */
export function geometryHitTestCanvasElement(
  host: HTMLElement,
  clientX: number,
  clientY: number
): HTMLElement | null {
  const hostRect = host.getBoundingClientRect();
  if (
    hostRect.width <= 0 ||
    hostRect.height <= 0 ||
    !pointInClientRect(clientX, clientY, hostRect)
  ) {
    return null;
  }
  const hostArea = hostRect.width * hostRect.height;
  let best: HTMLElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  let bestLarge: HTMLElement | null = null;
  let bestLargeArea = Number.POSITIVE_INFINITY;

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (
      node instanceof HTMLElement &&
      node !== host &&
      !isIgnorableCanvasPickTarget(node)
    ) {
      const tag = node.tagName.toLowerCase();
      if (tag !== "script" && tag !== "style" && tag !== "link") {
        const rect = node.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          pointInClientRect(clientX, clientY, rect)
        ) {
          const area = rect.width * rect.height;
          // Prefer tight boxes; near-full-host shells only as last resort.
          if (area < hostArea * 0.98) {
            if (area < bestArea) {
              best = node;
              bestArea = area;
            }
          } else if (area < bestLargeArea) {
            bestLarge = node;
            bestLargeArea = area;
          }
        }
      }
    }
    node = walker.nextNode();
  }
  return best ?? bestLarge;
}

/**
 * Hit-test the live canvas under a client point.
 * Callers that sit above the host should temporarily disable picker chrome PE
 * before calling (so elementsFromPoint sees host content).
 *
 * Order:
 * 1) event.composedPath() — works when the pick layer does not cover the point
 * 2) elementsFromPoint stack (skip chrome)
 * 3) geometry smallest-box fallback under host
 */
export function hitTestCanvasElement(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  event?: Event
): HTMLElement | null {
  if (event && typeof event.composedPath === "function") {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element) || isIgnorableCanvasPickTarget(node)) {
        continue;
      }
      const resolved = resolveHtmlUnderHost(host, node);
      if (resolved) {
        return resolved;
      }
    }
  }

  const stack: Element[] = [];
  if (typeof document.elementsFromPoint === "function") {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      stack.push(el);
    }
  } else if (typeof document.elementFromPoint === "function") {
    const raw = document.elementFromPoint(clientX, clientY);
    if (raw) {
      stack.push(raw);
    }
  }

  for (const raw of stack) {
    if (isIgnorableCanvasPickTarget(raw)) {
      continue;
    }
    const resolved = resolveHtmlUnderHost(host, raw);
    if (resolved) {
      return resolved;
    }
  }
  return geometryHitTestCanvasElement(host, clientX, clientY);
}

/**
 * Hit-test under a point (with optional pick-layer disable) and return chain.
 * Disables the pick layer and, when present, the whole comment overlay so
 * browser hit-test sees host content; geometry fallback still runs if needed.
 */
export function hitCanvasPickChainAtPoint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  blockLayer?: HTMLElement | null,
  event?: Event
): CanvasPickChain | null {
  const chromeRoots: HTMLElement[] = [];
  if (blockLayer) {
    chromeRoots.push(blockLayer);
    const overlay = blockLayer.closest("[data-slot='canvas-comment-overlay']");
    if (overlay instanceof HTMLElement && overlay !== blockLayer) {
      chromeRoots.push(overlay);
    }
  }
  const previousPe = chromeRoots.map((el) => el.style.pointerEvents);
  for (const el of chromeRoots) {
    el.style.pointerEvents = "none";
  }
  try {
    const leaf = hitTestCanvasElement(host, clientX, clientY, event);
    if (!leaf) {
      return null;
    }
    return buildCanvasPickChain(host, leaf);
  } finally {
    for (let i = 0; i < chromeRoots.length; i++) {
      const el = chromeRoots[i];
      if (el) {
        el.style.pointerEvents = previousPe[i] ?? "";
      }
    }
  }
}

/**
 * Hit-test + pick at default depth (tests / simple callers).
 */
export function resolveCanvasPickAtPoint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  blockLayer?: HTMLElement | null
): { readonly element: HTMLElement; readonly pick: CanvasElementPick } | null {
  const hit = hitCanvasPickChainAtPoint(host, clientX, clientY, blockLayer);
  if (!hit) {
    return null;
  }
  const element = hit.chain[hit.defaultDepth] ?? hit.leaf;
  return {
    element,
    pick: snapshotCanvasElementPick(host, element, hit.chain),
  };
}
