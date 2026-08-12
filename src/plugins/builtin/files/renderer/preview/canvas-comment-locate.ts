/**
 * Locate canvas comment pins on the live host (declared id → text match → soft).
 * Unlocated threads go to drift (status-bar list), never a top-left chip stack.
 */
import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import type { CanvasElementPick } from "./canvas-element-pick.ts";
import {
  findCanvasElementByLabel,
  findInteractiveByExactLabel,
  measureCanvasPickBox,
  pinPointFromBox,
} from "./canvas-element-pick.ts";
import type {
  CanvasCommentThreadView,
  CanvasSoftMarker,
} from "./use-canvas-preview-comments.ts";

function elementArea(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const area = rect.width * rect.height;
  return area > 0 ? area : Number.POSITIVE_INFINITY;
}

function pinPrimaryLabel(pin: CanvasCommentPinView): string {
  return (
    pin.threads[0]?.label?.trim() ||
    pin.title.trim() ||
    ""
  ).toLowerCase();
}

function resolvePinTargetElement(
  host: HTMLElement,
  pin: CanvasCommentPinView
): HTMLElement | null {
  if (pin.key.startsWith("anchor-")) {
    return findCanvasCommentAnchorElement(
      host,
      pin.key.slice("anchor-".length)
    );
  }
  for (const thread of pin.threads) {
    if (!thread.label) {
      continue;
    }
    // Prefer exact interactive (tab/button) so "落地" never resolves to a wide bar.
    const interactive = findInteractiveByExactLabel(host, thread.label);
    if (interactive) {
      return interactive;
    }
    const el = findCanvasElementByLabel(host, thread.label);
    if (el) {
      return el;
    }
  }
  return null;
}

/**
 * If Design Mode pick hits a target that already has a pin, return that pin.
 * Sibling tabs must not open each other's pins (label must agree on nested hits).
 */
export function findPinForCanvasPick(
  host: HTMLElement,
  pick: CanvasElementPick,
  pickedElement: HTMLElement,
  pins: readonly CanvasCommentPinView[]
): CanvasCommentPinView | null {
  if (pick.anchorId) {
    const byAnchor = pins.find((pin) => pin.key === `anchor-${pick.anchorId}`);
    if (byAnchor) {
      return byAnchor;
    }
  }

  const pickLabel = pick.label.trim().toLowerCase();
  const candidates: { pin: CanvasCommentPinView; score: number }[] = [];

  for (const pin of pins) {
    const pinLabel = pinPrimaryLabel(pin);
    const target = resolvePinTargetElement(host, pin);

    // Labels disagree → never treat as the same annotation target (e.g. 设计 vs 落地).
    if (pickLabel.length > 0 && pinLabel.length > 0 && pickLabel !== pinLabel) {
      continue;
    }

    if (!target) {
      if (pickLabel.length > 0 && pickLabel === pinLabel) {
        candidates.push({ pin, score: Number.POSITIVE_INFINITY - 1 });
      }
      continue;
    }

    if (target === pickedElement) {
      candidates.push({ pin, score: 0 });
      continue;
    }

    // Text/icon inside the same control (e.g. span inside tab button).
    if (target.contains(pickedElement)) {
      candidates.push({ pin, score: elementArea(target) });
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.pin ?? null;
}

export function locateCanvasCommentPins(input: {
  readonly host: HTMLElement;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly shell: HTMLElement;
  readonly softMarkers: readonly CanvasSoftMarker[];
}): {
  readonly driftThreads: readonly CanvasCommentThreadView[];
  readonly pins: readonly CanvasCommentPinView[];
} {
  const { host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers } =
    input;
  const softById = new Map(
    softMarkers.map((marker) => [marker.threadId, marker] as const)
  );
  const pins: CanvasCommentPinView[] = [];
  const drift: CanvasCommentThreadView[] = [];
  let index = 1;

  for (const [anchorId, threads] of locatedByAnchorId) {
    const el = findCanvasCommentAnchorElement(host, anchorId);
    if (!el) {
      drift.push(...threads);
      continue;
    }
    const box = measureCanvasPickBox(el, shell);
    const point = pinPointFromBox(box);
    const title = threads[0]?.label ?? threads[0]?.comment.body ?? anchorId;
    pins.push({
      index,
      key: `anchor-${anchorId}`,
      left: point.left,
      threads,
      title,
      top: point.top,
    });
    index += 1;
  }

  for (const thread of pickedNodeThreads) {
    const el =
      findInteractiveByExactLabel(host, thread.label) ??
      findCanvasElementByLabel(host, thread.label);
    if (el) {
      const box = measureCanvasPickBox(el, shell);
      const point = pinPointFromBox(box);
      pins.push({
        index,
        key: `picked-${thread.threadId}`,
        left: point.left,
        threads: [thread],
        title: thread.label ?? thread.comment.body,
        top: point.top,
      });
      index += 1;
      continue;
    }
    const soft = softById.get(thread.threadId);
    if (soft) {
      // Prefer live re-locate by stored soft label before painting stale coords.
      const softEl =
        findInteractiveByExactLabel(host, soft.label) ??
        findCanvasElementByLabel(host, soft.label);
      if (softEl) {
        const box = measureCanvasPickBox(softEl, shell);
        const point = pinPointFromBox(box);
        pins.push({
          index,
          key: `soft-${thread.threadId}`,
          left: point.left,
          threads: [thread],
          title: soft.label,
          top: point.top,
        });
      } else {
        pins.push({
          index,
          key: `soft-${thread.threadId}`,
          left: soft.left,
          threads: [thread],
          title: soft.label,
          top: soft.top,
        });
      }
      index += 1;
      continue;
    }
    drift.push(thread);
  }

  return { driftThreads: drift, pins };
}
