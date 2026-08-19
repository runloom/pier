/**
 * Label-based re-locate helpers for canvas comment pins / soft markers.
 */
import {
  canvasPickLabelStem,
  INTERACTIVE_SELECTOR,
  isCanvasCommentTargetVisible,
  normalizeCanvasPickText,
} from "./canvas-pick-shared.ts";

/** Exact label match on interactive controls (tabs/buttons) — safest re-locate. */
export function findInteractiveByExactLabel(
  host: HTMLElement,
  label: string | undefined
): HTMLElement | null {
  const needle = normalizeCanvasPickText(label, 80).toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  const nodes = host.querySelectorAll(INTERACTIVE_SELECTOR);
  let best: HTMLElement | null = null;
  let hiddenMatch: HTMLElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!(node instanceof HTMLElement && host.contains(node))) {
      continue;
    }
    const aria = node.getAttribute("aria-label")?.trim().toLowerCase() ?? "";
    const text = normalizeCanvasPickText(node.textContent, 80).toLowerCase();
    if (aria !== needle && text !== needle) {
      continue;
    }
    if (!isCanvasCommentTargetVisible(node)) {
      hiddenMatch ??= node;
      continue;
    }
    const rect = node.getBoundingClientRect();
    const area =
      rect.width > 0 && rect.height > 0 ? rect.width * rect.height : 1;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best ?? hiddenMatch;
}

/**
 * Best-effort re-locate a no-id pick by label under host.
 * Prefers exact / short label matches on compact nodes (tabs, buttons, cards).
 * Rejects "label appears somewhere inside a huge container" (prevents wrong pin).
 */
export function findCanvasElementByLabel(
  host: HTMLElement,
  label: string | undefined,
  excerpt?: string | undefined
): HTMLElement | null {
  const needles = [label, excerpt]
    .map((value) => normalizeCanvasPickText(value, 80))
    .filter((value) => value.length >= 1);
  if (needles.length === 0) {
    return null;
  }

  // Tabs/buttons: exact interactive match first (avoids nav/container false hits).
  const exactInteractive = findInteractiveByExactLabel(host, label);
  if (exactInteractive) {
    return exactInteractive;
  }

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const consider = (el: HTMLElement, scoreText: string) => {
    if (el === host || !host.contains(el)) {
      return;
    }
    const hay = normalizeCanvasPickText(scoreText, 120).toLowerCase();
    if (hay.length === 0) {
      return;
    }
    let matchRank = 999;
    for (const needle of needles) {
      const n = needle.toLowerCase();
      const stem = canvasPickLabelStem(n);
      if (stem.length === 0) {
        continue;
      }
      // Truncated labels only rematch when live text starts with the stem.
      // A 2-char reverse prefix ("物料") would pin another tab's Alert here.
      const truncated = n !== stem;
      if (hay === n || hay === stem) {
        matchRank = Math.min(matchRank, 0);
      } else if (hay.startsWith(stem) && hay.length <= stem.length * 2 + 8) {
        matchRank = Math.min(matchRank, 1);
      } else if (!truncated && stem.startsWith(hay) && hay.length >= 2) {
        matchRank = Math.min(matchRank, 2);
      } else if (
        !truncated &&
        hay.includes(stem) &&
        hay.length <= stem.length * 3 + 16
      ) {
        matchRank = Math.min(matchRank, 3);
      }
    }
    if (matchRank >= 999) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const area =
      rect.width > 0 && rect.height > 0 ? rect.width * rect.height : 1;
    // Hidden-tab exact/prefix beats a weaker visible lookalike so the pin
    // stays off-screen until that tab is revealed.
    const hiddenBias = isCanvasCommentTargetVisible(el) ? 0 : 400_000;
    const score = matchRank * 1_000_000 + hiddenBias + area;
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  };

  for (const node of host.querySelectorAll("[aria-label]")) {
    if (node instanceof HTMLElement) {
      consider(node, node.getAttribute("aria-label") ?? "");
    }
  }

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current instanceof HTMLElement && current !== host) {
      const tag = current.tagName.toLowerCase();
      if (tag !== "script" && tag !== "style" && tag !== "svg") {
        consider(current, current.textContent ?? "");
      }
    }
    current = walker.nextNode();
  }

  return best;
}
