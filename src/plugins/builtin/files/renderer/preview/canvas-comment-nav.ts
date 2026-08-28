/**
 * Canvas comment n/N: one file list, reveal hidden/unmounted tabs, then pin.
 */
import { resolveCanvasCommentNavTargetElement } from "./canvas-comment-locate.ts";
import { primaryCanvasPinThread } from "./canvas-comment-order.ts";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import {
  isCanvasCommentTargetVisible,
  isCanvasTabTrigger,
  normalizeCanvasPickText,
} from "./canvas-pick-shared.ts";
import { detectCanvasStage } from "./canvas-stage.ts";
import type { CanvasCommentThreadView } from "./use-canvas-preview-comments.ts";

export interface CanvasCommentNavTarget {
  readonly anchorId?: string;
  readonly commentId: string;
  /** 1-based pin number (same glyph as the marker). */
  readonly index: number;
  readonly label?: string;
  readonly pinKey: string | null;
  readonly threadId: string;
}

/**
 * Navigator steps: one per locatable pin (visible + hidden tab), oldest first.
 * Pin numbers and n/N are this list (same number as the pin).
 */
export function buildCanvasCommentNavTargets(input: {
  readonly hiddenPins: readonly CanvasCommentPinView[];
  readonly pins: readonly CanvasCommentPinView[];
}): CanvasCommentNavTarget[] {
  return [...input.pins, ...input.hiddenPins]
    .sort((left, right) => {
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      return left.key.localeCompare(right.key);
    })
    .flatMap((pin) => {
      const oldest = primaryCanvasPinThread(pin.threads);
      if (oldest === undefined) {
        return [];
      }
      return [
        {
          commentId: oldest.comment.id,
          index: pin.index,
          pinKey: pin.key,
          threadId: oldest.threadId,
          ...(oldest.anchorId === undefined
            ? {}
            : { anchorId: oldest.anchorId }),
          ...(oldest.label === undefined ? {} : { label: oldest.label }),
        },
      ];
    });
}

export function buildCanvasCommentClearTargets(
  threads: readonly CanvasCommentThreadView[]
): CanvasCommentNavTarget[] {
  return threads.map((thread) => ({
    commentId: thread.comment.id,
    index: 0,
    pinKey: null,
    threadId: thread.threadId,
    ...(thread.anchorId === undefined ? {} : { anchorId: thread.anchorId }),
    ...(thread.label === undefined ? {} : { label: thread.label }),
  }));
}

const TAB_TRIGGER_SELECTOR = "[role='tab'],[data-slot='tabs-trigger']";
const PIN_SCROLL_WAIT_MS = 2000;
const TAB_HUNT_STEP_MS = 50;

function isInactiveCanvasTabTrigger(el: HTMLElement): boolean {
  return (
    el.getAttribute("data-state") === "inactive" ||
    el.getAttribute("aria-selected") === "false"
  );
}

function inactiveCanvasTabTriggers(host: HTMLElement): HTMLElement[] {
  const triggers: HTMLElement[] = [];
  for (const node of host.querySelectorAll(TAB_TRIGGER_SELECTOR)) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (isInactiveCanvasTabTrigger(node)) {
      triggers.push(node);
    }
  }
  return triggers;
}

function activeCanvasTabTrigger(host: HTMLElement): HTMLElement | null {
  for (const node of host.querySelectorAll(TAB_TRIGGER_SELECTOR)) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (!isInactiveCanvasTabTrigger(node)) {
      return node;
    }
  }
  return null;
}

/**
 * Radix TabsTrigger switches on mousedown / focus, not click().
 * Keep click() for plain buttons that only listen to click.
 */
function activateCanvasTabTrigger(trigger: HTMLElement): void {
  trigger.focus();
  trigger.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    })
  );
  trigger.click();
}

function findCanvasTabTriggerByLabel(
  host: HTMLElement,
  label: string | undefined
): HTMLElement | null {
  const needle = normalizeCanvasPickText(label, 80).toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  for (const node of host.querySelectorAll(TAB_TRIGGER_SELECTOR)) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const aria = node.getAttribute("aria-label")?.trim().toLowerCase() ?? "";
    const text = normalizeCanvasPickText(node.textContent, 80).toLowerCase();
    if (aria === needle || text === needle) {
      return node;
    }
  }
  return null;
}

function preferTabTrigger(
  triggers: HTMLElement[],
  preferred: HTMLElement | null
): HTMLElement[] {
  if (!(preferred && isInactiveCanvasTabTrigger(preferred))) {
    return triggers;
  }
  const next = triggers.filter((entry) => entry !== preferred);
  next.unshift(preferred);
  return next;
}

/** Activate the tab that owns this target so its panel can paint. */
export function revealCanvasTabPanelForTarget(el: HTMLElement): boolean {
  if (isCanvasTabTrigger(el)) {
    if (!isInactiveCanvasTabTrigger(el)) {
      return false;
    }
    activateCanvasTabTrigger(el);
    return true;
  }
  if (isCanvasCommentTargetVisible(el)) {
    return false;
  }
  const panel = el.closest("[data-slot='tabs-content'],[role='tabpanel']");
  if (!(panel instanceof HTMLElement)) {
    return false;
  }
  const doc = panel.ownerDocument;
  const labelledBy = panel.getAttribute("aria-labelledby")?.trim() ?? "";
  if (labelledBy.length > 0) {
    for (const id of labelledBy.split(/\s+/u)) {
      const trigger = doc.getElementById(id);
      if (trigger instanceof HTMLElement) {
        activateCanvasTabTrigger(trigger);
        return true;
      }
    }
  }
  const panelId = panel.id.trim();
  if (panelId.length === 0) {
    return false;
  }
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(panelId)
      : panelId.replaceAll(/["\\]/gu, "\\$&");
  const byControls = doc.querySelector(`[aria-controls="${escaped}"]`);
  if (byControls instanceof HTMLElement) {
    activateCanvasTabTrigger(byControls);
    return true;
  }
  return false;
}

export function scheduleCanvasCommentPinScroll(
  shell: HTMLElement,
  pinIndex: number,
  onReady?: () => void,
  host?: HTMLElement | null
): () => void {
  let cancelled = false;
  let observer: MutationObserver | null = null;
  let timer = 0;
  const isWorld = host ? detectCanvasStage(host).stage === "world" : false;
  const tryScroll = (): boolean => {
    if (cancelled) {
      return true;
    }
    const pinEl = shell.querySelector(
      `[data-canvas-comment-pin="${pinIndex}"]`
    );
    if (!(pinEl instanceof HTMLElement)) {
      return false;
    }
    if (!isWorld) {
      pinEl.scrollIntoView({ block: "center", behavior: "auto" });
    }
    onReady?.();
    return true;
  };
  if (tryScroll()) {
    return () => {
      cancelled = true;
    };
  }
  observer = new MutationObserver(() => {
    if (tryScroll()) {
      observer?.disconnect();
      window.clearTimeout(timer);
    }
  });
  observer.observe(shell, { childList: true, subtree: true });
  timer = window.setTimeout(() => {
    observer?.disconnect();
  }, PIN_SCROLL_WAIT_MS);
  return () => {
    cancelled = true;
    observer?.disconnect();
    window.clearTimeout(timer);
  };
}

function scheduleUnmountedTabHunt(
  host: HTMLElement,
  findTarget: () => HTMLElement | null,
  onFound: (el: HTMLElement) => void,
  preferredTrigger: HTMLElement | null
): () => void {
  let cancelled = false;
  let timer = 0;
  const original = activeCanvasTabTrigger(host);
  const triggers = preferTabTrigger(
    inactiveCanvasTabTriggers(host),
    preferredTrigger
  );
  let next = 0;
  const finish = (found: HTMLElement | null): void => {
    cancelled = true;
    observer.disconnect();
    window.clearTimeout(timer);
    if (found) {
      onFound(found);
      return;
    }
    if (original && isInactiveCanvasTabTrigger(original)) {
      activateCanvasTabTrigger(original);
    }
  };
  const observer = new MutationObserver(() => {
    if (cancelled) {
      return;
    }
    const found = findTarget();
    if (found) {
      finish(found);
    }
  });
  observer.observe(host, {
    attributeFilter: ["data-state", "hidden"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  const activateNext = (): void => {
    if (cancelled) {
      return;
    }
    const found = findTarget();
    if (found) {
      finish(found);
      return;
    }
    const trigger = triggers[next];
    next += 1;
    if (trigger === undefined) {
      finish(null);
      return;
    }
    activateCanvasTabTrigger(trigger);
    timer = window.setTimeout(activateNext, TAB_HUNT_STEP_MS);
  };
  activateNext();
  return () => {
    cancelled = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

export function revealCanvasCommentNavTarget(input: {
  readonly hiddenPins: readonly CanvasCommentPinView[];
  readonly host: HTMLElement | null;
  readonly onOpenPin: (pinKey: string) => void;
  readonly pins: readonly CanvasCommentPinView[];
  readonly shell: HTMLElement | null;
  readonly target: CanvasCommentNavTarget;
}): () => void {
  const { host, target } = input;
  if (!host) {
    return () => undefined;
  }
  const isFileLevel =
    target.pinKey === null &&
    target.anchorId === undefined &&
    target.label === undefined;
  if (isFileLevel) {
    return () => undefined;
  }
  const findTarget = (): HTMLElement | null =>
    resolveCanvasCommentNavTargetElement(
      host,
      target,
      input.pins,
      input.hiddenPins
    );
  const openAndScroll = (): (() => void) => {
    const open = (): void => {
      if (target.pinKey !== null) {
        input.onOpenPin(target.pinKey);
      }
    };
    if (!input.shell) {
      open();
      return () => undefined;
    }
    return scheduleCanvasCommentPinScroll(
      input.shell,
      target.index,
      open,
      input.host
    );
  };
  const located = findTarget();
  if (located) {
    revealCanvasTabPanelForTarget(located);
    return openAndScroll();
  }
  let scrollCleanup: (() => void) | undefined;
  const huntCleanup = scheduleUnmountedTabHunt(
    host,
    findTarget,
    (el) => {
      revealCanvasTabPanelForTarget(el);
      scrollCleanup = openAndScroll();
    },
    findCanvasTabTriggerByLabel(host, target.label)
  );
  return () => {
    huntCleanup();
    scrollCleanup?.();
  };
}
