import type { TerminalFrame } from "@shared/contracts/terminal.ts";

type WindowLayoutPulseReason = "resize" | "zoom";

export type TerminalLayoutFlushReason =
  | "anchor-resize"
  | "dockview-dimensions"
  | "dockview-layout"
  | "dockview-maximize"
  | "visibility"
  | "window-resize"
  | `window-${WindowLayoutPulseReason}`;

interface TerminalAnchorState {
  anchor: HTMLDivElement;
  frameRequest: number | null;
  lastFrameKey: string;
  panelId: string;
  resizeObserver: ResizeObserver | null;
}

export interface TerminalLayoutRegistration {
  dispose(): void;
  flushNow(reason: TerminalLayoutFlushReason): void;
  flushTrailing(reason: TerminalLayoutFlushReason): void;
}

const anchors = new Map<string, TerminalAnchorState>();
let windowResizeInstalled = false;
let windowLayoutPulseDispose: (() => void) | null = null;

export function readTerminalAnchorFrame(
  anchor: HTMLDivElement
): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function debugEnabled(): boolean {
  try {
    return window.localStorage?.getItem("pierTerminalLayoutDebug") === "1";
  } catch {
    return false;
  }
}

function debugFrame(
  reason: TerminalLayoutFlushReason,
  panelId: string,
  frame: TerminalFrame
): void {
  if (!debugEnabled()) {
    return;
  }
  console.debug("[pier-terminal-layout]", {
    frame,
    panelId,
    reason,
    time: performance.now(),
  });
}

function sendFrameNow(
  state: TerminalAnchorState,
  reason: TerminalLayoutFlushReason
): void {
  const frame = readTerminalAnchorFrame(state.anchor);
  if (!frame) {
    return;
  }
  const key = frameKey(frame);
  if (key === state.lastFrameKey) {
    return;
  }
  state.lastFrameKey = key;
  debugFrame(reason, state.panelId, frame);
  window.pier.terminal.setFrame(state.panelId, frame);
}

function flushTrailing(
  state: TerminalAnchorState,
  reason: TerminalLayoutFlushReason
): void {
  sendFrameNow(state, reason);
  if (state.frameRequest !== null) {
    cancelAnimationFrame(state.frameRequest);
  }

  let remainingFrames = 2;
  const tick = () => {
    sendFrameNow(state, reason);
    remainingFrames -= 1;
    if (remainingFrames > 0) {
      state.frameRequest = requestAnimationFrame(tick);
      return;
    }
    state.frameRequest = null;
  };
  state.frameRequest = requestAnimationFrame(tick);
}

export function flushTerminalLayoutFrames(
  reason: TerminalLayoutFlushReason
): void {
  for (const state of anchors.values()) {
    sendFrameNow(state, reason);
  }
}

export function flushTerminalLayoutFramesTrailing(
  reason: TerminalLayoutFlushReason
): void {
  for (const state of anchors.values()) {
    flushTrailing(state, reason);
  }
}

function handleWindowResize(): void {
  flushTerminalLayoutFramesTrailing("window-resize");
}

function ensureGlobalListeners(): void {
  if (!windowResizeInstalled) {
    window.addEventListener("resize", handleWindowResize);
    windowResizeInstalled = true;
  }
  if (!windowLayoutPulseDispose) {
    windowLayoutPulseDispose =
      window.pier?.onWindowLayoutPulse?.((pulse) => {
        flushTerminalLayoutFramesTrailing(`window-${pulse.reason}`);
      }) ?? null;
  }
}

function maybeDisposeGlobalListeners(): void {
  if (anchors.size > 0) {
    return;
  }
  if (windowResizeInstalled) {
    window.removeEventListener("resize", handleWindowResize);
    windowResizeInstalled = false;
  }
  windowLayoutPulseDispose?.();
  windowLayoutPulseDispose = null;
}

export function registerTerminalLayoutAnchor(
  panelId: string,
  anchor: HTMLDivElement
): TerminalLayoutRegistration {
  const pendingFrameRequest = anchors.get(panelId)?.frameRequest;
  if (pendingFrameRequest !== null && pendingFrameRequest !== undefined) {
    cancelAnimationFrame(pendingFrameRequest);
  }
  const state: TerminalAnchorState = {
    anchor,
    frameRequest: null,
    lastFrameKey: "",
    panelId,
    resizeObserver: null,
  };
  state.resizeObserver = new ResizeObserver(() => {
    sendFrameNow(state, "anchor-resize");
  });
  state.resizeObserver.observe(anchor);
  anchors.set(panelId, state);
  ensureGlobalListeners();

  return {
    dispose() {
      if (state.frameRequest !== null) {
        cancelAnimationFrame(state.frameRequest);
      }
      state.resizeObserver?.disconnect();
      if (anchors.get(panelId) === state) {
        anchors.delete(panelId);
      }
      maybeDisposeGlobalListeners();
    },
    flushNow(reason) {
      sendFrameNow(state, reason);
    },
    flushTrailing(reason) {
      flushTrailing(state, reason);
    },
  };
}
