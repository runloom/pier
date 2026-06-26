import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

type WindowLayoutPulseReason = WindowLayoutPulse["reason"];

export type TerminalLayoutFlushReason =
  | "anchor-resize"
  | "dockview-active-panel"
  | "dockview-dimensions"
  | "dockview-layout"
  | "dockview-maximize"
  | "restore"
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
let presentationScheduler:
  | ((reason: TerminalLayoutFlushReason) => void)
  | null = null;

export function readTerminalAnchorFrame(
  anchor: HTMLDivElement
): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) {
    return null;
  }
  return cssRectToContentViewRect(
    {
      height: r.height,
      width: r.width,
      x: r.x,
      y: r.y,
    },
    useZoomStore.getState().windowZoomLevel
  );
}

export function readTerminalViewportFrame(): TerminalFrame {
  return cssRectToContentViewRect(
    {
      height: window.innerHeight,
      width: window.innerWidth,
      x: 0,
      y: 0,
    },
    useZoomStore.getState().windowZoomLevel
  );
}

export function isRegisteredTerminalAnchorVisible(panelId: string): boolean {
  const state = anchors.get(panelId);
  return state ? readTerminalAnchorFrame(state.anchor) !== null : false;
}

export function hasRegisteredTerminalAnchor(panelId: string): boolean {
  return anchors.has(panelId);
}

export function readRegisteredTerminalAnchorFrame(
  panelId: string
): TerminalFrame | null {
  const state = anchors.get(panelId);
  return state ? readTerminalAnchorFrame(state.anchor) : null;
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

export function setTerminalLayoutPresentationScheduler(
  scheduler: ((reason: TerminalLayoutFlushReason) => void) | null
): () => void {
  presentationScheduler = scheduler;
  return () => {
    if (presentationScheduler === scheduler) {
      presentationScheduler = null;
    }
  };
}

function notifyPresentationChange(reason: TerminalLayoutFlushReason): void {
  presentationScheduler?.(reason);
}

function observeFrameNow(
  state: TerminalAnchorState,
  reason: TerminalLayoutFlushReason
): void {
  const frame = readTerminalAnchorFrame(state.anchor);
  if (!frame) {
    if (state.lastFrameKey !== "") {
      state.lastFrameKey = "";
      notifyPresentationChange(reason);
    }
    return;
  }
  const key = frameKey(frame);
  if (key === state.lastFrameKey) {
    return;
  }
  state.lastFrameKey = key;
  debugFrame(reason, state.panelId, frame);
  notifyPresentationChange(reason);
}

function flushTrailing(
  state: TerminalAnchorState,
  reason: TerminalLayoutFlushReason
): void {
  observeFrameNow(state, reason);
  if (state.frameRequest !== null) {
    cancelAnimationFrame(state.frameRequest);
  }

  let remainingFrames = 2;
  const tick = () => {
    observeFrameNow(state, reason);
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
    observeFrameNow(state, reason);
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
        if (
          pulse.reason === "view-zoom" &&
          typeof pulse.windowZoomLevel === "number"
        ) {
          useZoomStore.setState({ windowZoomLevel: pulse.windowZoomLevel });
        }
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
    observeFrameNow(state, "anchor-resize");
  });
  state.resizeObserver.observe(anchor);
  anchors.set(panelId, state);
  ensureGlobalListeners();
  notifyPresentationChange("visibility");

  return {
    dispose() {
      if (state.frameRequest !== null) {
        cancelAnimationFrame(state.frameRequest);
      }
      state.resizeObserver?.disconnect();
      if (anchors.get(panelId) === state) {
        anchors.delete(panelId);
      }
      notifyPresentationChange("visibility");
      maybeDisposeGlobalListeners();
    },
    flushNow(reason) {
      observeFrameNow(state, reason);
    },
    flushTrailing(reason) {
      flushTrailing(state, reason);
    },
  };
}
