/**
 * Locate canvas comment pins: group by identity first, then paint live nodes.
 * Same id/label = one pin. Unmounted / other-tab groups stay in hiddenPins (n/N).
 * File-level comments (no id, no label) go to drift, never a top-left chip stack.
 */
import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import {
  canvasCommentPinIdentityKey,
  primaryCanvasPinThread,
  sortLiveCanvasCommentThreads,
} from "./canvas-comment-order.ts";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import type { CanvasElementPick } from "./canvas-element-pick.ts";
import {
  findCanvasElementByLabel,
  findInteractiveByExactLabel,
  measureCanvasPickBox,
  pinPointFromBox,
} from "./canvas-element-pick.ts";
import {
  COPY_LEAF_SELECTOR,
  INTERACTIVE_SELECTOR,
  isCanvasCommentTargetVisible,
} from "./canvas-pick-shared.ts";
import type {
  CanvasCommentThreadView,
  CanvasSoftMarker,
} from "./use-canvas-preview-comments.ts";

type CanvasCommentPinDraft = Omit<CanvasCommentPinView, "index">;

interface CanvasCommentIdentityGroup {
  key: string;
  threads: CanvasCommentThreadView[];
  title: string;
}

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

function pinCreatedAt(draft: CanvasCommentPinDraft): number {
  return primaryCanvasPinThread(draft.threads)?.comment.createdAt ?? 0;
}

/** Oldest identity is 1, including targets not on the current tab. */
function numberIdentityPins(
  drafts: readonly CanvasCommentPinDraft[]
): CanvasCommentPinView[] {
  return [...drafts]
    .sort((left, right) => {
      const byTime = pinCreatedAt(left) - pinCreatedAt(right);
      if (byTime !== 0) {
        return byTime;
      }
      return left.key.localeCompare(right.key);
    })
    .map((pin, offset) => ({ ...pin, index: offset + 1 }));
}

function pushIdentityThread(
  groups: Map<string, CanvasCommentIdentityGroup>,
  key: string,
  thread: CanvasCommentThreadView,
  title: string
): void {
  const prev = groups.get(key);
  if (!prev) {
    groups.set(key, { key, threads: [thread], title });
    return;
  }
  if (prev.threads.some((entry) => entry.threadId === thread.threadId)) {
    return;
  }
  const threads = sortLiveCanvasCommentThreads([...prev.threads, thread]);
  const primary = primaryCanvasPinThread(threads);
  groups.set(key, {
    key,
    threads,
    title: primary?.label ?? primary?.comment.body ?? prev.title,
  });
}

function pinDraftFromElement(
  el: HTMLElement | null,
  shell: HTMLElement,
  draft: Omit<CanvasCommentPinDraft, "left" | "top">
): CanvasCommentPinDraft | "hidden" | null {
  if (!el) {
    return null;
  }
  if (!isCanvasCommentTargetVisible(el)) {
    return "hidden";
  }
  const point = pinPointFromBox(measureCanvasPickBox(el, shell));
  return {
    ...draft,
    left: point.left,
    top: point.top,
  };
}

function hiddenPinDraft(
  draft: Omit<CanvasCommentPinDraft, "left" | "top">
): CanvasCommentPinDraft {
  return { ...draft, left: 0, top: 0 };
}

/**
 * Alert is one commentable unit. Title/body/icon rematch lifts to the alert
 * so the pin sits on the banner, not a fragment. Copy leaves and nested
 * controls stay where they were picked.
 */
function liftCanvasCommentPinTarget(
  host: HTMLElement,
  el: HTMLElement
): HTMLElement {
  const alert = el.closest("[data-slot='alert'],[role='alert']");
  if (
    !(alert instanceof HTMLElement && host.contains(alert) && alert !== host)
  ) {
    return el;
  }
  if (el !== alert && el.matches(INTERACTIVE_SELECTOR)) {
    return el;
  }
  if (el.matches(COPY_LEAF_SELECTOR)) {
    return el;
  }
  return alert;
}

export function resolveCanvasCommentPinTarget(
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
      return liftCanvasCommentPinTarget(host, interactive);
    }
    const el = findCanvasElementByLabel(host, thread.label);
    if (el) {
      return liftCanvasCommentPinTarget(host, el);
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
    const target = resolveCanvasCommentPinTarget(host, pin);

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

export function resolveCanvasCommentNavTargetElement(
  host: HTMLElement,
  target: {
    readonly anchorId?: string;
    readonly label?: string;
    readonly pinKey: string | null;
  },
  pins: readonly CanvasCommentPinView[],
  hiddenPins: readonly CanvasCommentPinView[]
): HTMLElement | null {
  if (target.pinKey !== null) {
    const pin =
      pins.find((entry) => entry.key === target.pinKey) ??
      hiddenPins.find((entry) => entry.key === target.pinKey);
    if (pin) {
      const fromPin = resolveCanvasCommentPinTarget(host, pin);
      if (fromPin) {
        return fromPin;
      }
    }
  }
  if (target.anchorId !== undefined && target.anchorId.length > 0) {
    const byAnchor = findCanvasCommentAnchorElement(host, target.anchorId);
    if (byAnchor) {
      return byAnchor;
    }
  }
  if (target.label !== undefined && target.label.length > 0) {
    const byLabel =
      findInteractiveByExactLabel(host, target.label) ??
      findCanvasElementByLabel(host, target.label);
    return byLabel ? liftCanvasCommentPinTarget(host, byLabel) : null;
  }
  return null;
}

export function locateCanvasCommentPins(input: {
  readonly host: HTMLElement;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly shell: HTMLElement;
  readonly softMarkers: readonly CanvasSoftMarker[];
}): {
  readonly driftThreads: readonly CanvasCommentThreadView[];
  readonly hiddenPins: readonly CanvasCommentPinView[];
  readonly pins: readonly CanvasCommentPinView[];
} {
  const { host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers } =
    input;
  const softById = new Map(
    softMarkers.map((marker) => [marker.threadId, marker] as const)
  );
  const groups = new Map<string, CanvasCommentIdentityGroup>();
  const drift: CanvasCommentThreadView[] = [];

  for (const [anchorId, threads] of locatedByAnchorId) {
    const title = threads[0]?.label ?? threads[0]?.comment.body ?? anchorId;
    for (const thread of threads) {
      pushIdentityThread(groups, `anchor-${anchorId}`, thread, title);
    }
  }

  for (const thread of pickedNodeThreads) {
    const key = canvasCommentPinIdentityKey(thread);
    if (key === null) {
      drift.push(thread);
      continue;
    }
    pushIdentityThread(
      groups,
      key,
      thread,
      thread.label ?? thread.comment.body
    );
  }

  const numbered = numberIdentityPins(
    [...groups.values()].map((group) =>
      hiddenPinDraft({
        key: group.key,
        threads: group.threads,
        title: group.title,
      })
    )
  );
  const pins: CanvasCommentPinView[] = [];
  const hiddenPins: CanvasCommentPinView[] = [];
  for (const pin of numbered) {
    let el = resolveCanvasCommentPinTarget(host, pin);
    if (!el) {
      for (const thread of pin.threads) {
        const soft = softById.get(thread.threadId);
        if (!soft) {
          continue;
        }
        const found =
          findInteractiveByExactLabel(host, soft.label) ??
          findCanvasElementByLabel(host, soft.label);
        if (found) {
          el = liftCanvasCommentPinTarget(host, found);
          break;
        }
      }
    }
    const located = pinDraftFromElement(el, shell, {
      key: pin.key,
      threads: pin.threads,
      title: pin.title,
    });
    if (located && located !== "hidden") {
      pins.push({ ...located, index: pin.index });
      continue;
    }
    // Unmounted / other-tab / rematch miss: keep n/N, do not reuse stale
    // coordinates (those sit on whatever the current tab painted).
    hiddenPins.push(pin);
  }
  return {
    driftThreads: drift,
    hiddenPins,
    pins,
  };
}
