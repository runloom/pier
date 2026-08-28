/**
 * Design Mode element pick (Orca-like / inspector-style).
 *
 * Two phases (industry standard — promotion must never veto a hit):
 * 1) Hit resolution: elementsFromPoint → geometry fallback
 * 2) Target promotion: rank ancestors (anchor / interactive / …)
 *
 * Implementation is split by domain:
 * - canvas-pick-shared / -hit / -promote / -label
 */

export {
  geometryHitTestCanvasElement,
  hitCanvasPickChainAtPoint,
  hitTestCanvasElement,
  refineCanvasLayoutHit,
  resolveCanvasPickAtPoint,
} from "./canvas-pick-hit.ts";
export {
  findCanvasElementByLabel,
  findInteractiveByExactLabel,
} from "./canvas-pick-label.ts";
export {
  buildCanvasPickChain,
  clampPickDepth,
  defaultPickDepth,
  pickFromCanvasElement,
  resolveCanvasElementPick,
  snapshotCanvasElementPick,
} from "./canvas-pick-promote.ts";
export type {
  CanvasElementPick,
  CanvasPickChain,
  CanvasPickOverlayBox,
} from "./canvas-pick-shared.ts";

import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import {
  type CanvasElementPick,
  type CanvasPickOverlayBox,
  normalizeCanvasPickText,
} from "./canvas-pick-shared.ts";

/**
 * Visual scale applied by ancestors (world-stage CSS `zoom`). Client rects are
 * scaled while offset layout stays in local CSS px, so the ratio recovers the
 * factor; flow mode measures 1 and stays a no-op.
 */
export function canvasShellVisualScale(
  shell: HTMLElement,
  shellRect: Pick<DOMRect, "width">
): number {
  const layoutWidth = shell.offsetWidth;
  if (!(layoutWidth > 0 && shellRect.width > 0)) {
    return 1;
  }
  return shellRect.width / layoutWidth;
}

/** Measure element box relative to shell (for overlay highlight, no DOM style writes). */
export function measureCanvasPickBox(
  element: HTMLElement,
  shell: HTMLElement
): CanvasPickOverlayBox {
  const shellRect = shell.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const scale = canvasShellVisualScale(shell, shellRect);
  const tag = element.tagName.toLowerCase();
  const aria = element.getAttribute("aria-label")?.trim();
  const text = normalizeCanvasPickText(element.textContent, 40);
  const label = normalizeCanvasPickText(aria, 40) || text || tag;
  return {
    height: Math.max(0, rect.height) / scale,
    label: label.length > 0 ? label : tag,
    left: (rect.left - shellRect.left) / scale + shell.scrollLeft,
    top: (rect.top - shellRect.top) / scale + shell.scrollTop,
    width: Math.max(0, rect.width) / scale,
  };
}

/**
 * Pin anchor at the element's top-right corner (shell coords).
 * Pair with CSS translate so the disc sits half outside the corner
 * instead of eating the tab/button right padding.
 */
export function pinPointFromBox(box: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}): { left: number; top: number } {
  return {
    left: Math.max(0, box.left + box.width),
    top: Math.max(0, box.top),
  };
}

/** Pointer → overlay coordinates (same space as {@link measureCanvasPickBox}). */
export function clientPointInShell(
  shell: HTMLElement,
  clientX: number,
  clientY: number
): { readonly x: number; readonly y: number } {
  const rect = shell.getBoundingClientRect();
  const scale = canvasShellVisualScale(shell, rect);
  return {
    x: (clientX - rect.left) / scale + shell.scrollLeft,
    y: (clientY - rect.top) / scale + shell.scrollTop,
  };
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
