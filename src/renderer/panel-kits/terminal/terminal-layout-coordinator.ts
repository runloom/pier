import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { readTerminalAnchorFrame } from "./terminal-viewport.ts";

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
let presentationAppliedDispose: (() => void) | null = null;
let presentationScheduler:
  | ((reason: TerminalLayoutFlushReason) => void)
  | null = null;
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
  // resize 隐身期间终端已藏，跳过 flush（否则与 pulse 路径重复下发隐身帧）。
  if (useTerminalStore.getState().suppressTerminals) {
    return;
  }
  flushTerminalLayoutFramesTrailing("window-resize");
}

// 兜底：进入隐身后若迟迟收不到 'end'（maximize/全屏只发 zoom、或平台漏发 resized），
// 超时自动恢复，绝不让终端永久卡在隐身。每个 active 帧续期。
const RESIZE_FALLBACK_MS = 1000;
// 兜底：等 native「就位」ack 撤占位时，ack 万一丢失的超时保险。
const RESTORE_ACK_TIMEOUT_MS = 500;
let resizeFallbackTimer: number | null = null;
let restoreAckTimer: number | null = null;
let awaitingRestoreAck = false;
function clearResizeFallback(): void {
  if (resizeFallbackTimer !== null) {
    clearTimeout(resizeFallbackTimer);
    resizeFallbackTimer = null;
  }
}
function dismissResizePlaceholder(): void {
  awaitingRestoreAck = false;
  clearTimeout(restoreAckTimer ?? undefined);
  restoreAckTimer = null;
  if (resizeSuppressActive || hasGlobalSuppressHolder()) {
    return;
  }
  useTerminalStore.setState({ placeholderVisible: false });
}
/** Global suppress = resize drag OR holder without panelId. */
let resizeSuppressActive = false;
/** Refcounted holders; panelId undefined = global suppress. */
const suppressHolders = new Map<
  string,
  { count: number; panelId: string | undefined }
>();
function computeSuppressedPanelIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const { count, panelId } of suppressHolders.values()) {
    if (count > 0 && panelId !== undefined) {
      ids.add(panelId);
    }
  }
  return ids;
}
function hasGlobalSuppressHolder(): boolean {
  for (const { count, panelId } of suppressHolders.values()) {
    if (count > 0 && panelId === undefined) {
      return true;
    }
  }
  return false;
}
function syncSurfaceSuppression(options?: { showPlaceholder?: boolean }): void {
  const globalSuppress = resizeSuppressActive || hasGlobalSuppressHolder();
  const suppressedPanelIds = computeSuppressedPanelIds();
  const prev = useTerminalStore.getState();
  const sameGlobal = globalSuppress === prev.suppressTerminals;
  const samePanels =
    suppressedPanelIds.size === prev.suppressedPanelIds.size &&
    [...suppressedPanelIds].every((id) => prev.suppressedPanelIds.has(id));

  if (sameGlobal && samePanels) {
    if (
      globalSuppress &&
      options?.showPlaceholder &&
      !prev.placeholderVisible
    ) {
      useTerminalStore.setState({ placeholderVisible: true });
    }
    return;
  }

  if (globalSuppress) {
    awaitingRestoreAck = false;
    clearTimeout(restoreAckTimer ?? undefined);
    restoreAckTimer = null;
    useTerminalStore.setState({
      placeholderVisible: true,
      suppressTerminals: true,
      suppressedPanelIds,
    });
    notifyPresentationChange("visibility");
    return;
  }

  // Per-panel only / clear: never raise global suppress or global matte.
  const leavingGlobal = prev.suppressTerminals;
  useTerminalStore.setState({
    suppressTerminals: false,
    suppressedPanelIds,
    ...(leavingGlobal ? {} : { placeholderVisible: false }),
  });
  notifyPresentationChange("visibility");
  if (!leavingGlobal) {
    return;
  }
  awaitingRestoreAck = true;
  clearTimeout(restoreAckTimer ?? undefined);
  restoreAckTimer = window.setTimeout(
    dismissResizePlaceholder,
    RESTORE_ACK_TIMEOUT_MS
  );
}
/** Hold surfaces hidden until dispose. panelId scopes to one panel; omit = global. */
export function acquireTerminalSurfaceSuppression(
  id: string,
  panelId?: string
): () => void {
  const existing = suppressHolders.get(id);
  if (existing) {
    existing.count += 1;
    // Same holder id with a different scope: widen to global so we never
    // stick the first caller's panel-only mask across a later global acquire
    // (or two different panelIds under one id).
    if (existing.panelId !== panelId) {
      existing.panelId = undefined;
    }
  } else {
    suppressHolders.set(id, { count: 1, panelId });
  }
  syncSurfaceSuppression({ showPlaceholder: true });
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const holder = suppressHolders.get(id);
    if (!holder) {
      return;
    }
    holder.count -= 1;
    if (holder.count <= 0) {
      suppressHolders.delete(id);
    }
    syncSurfaceSuppression();
  };
}
/** Brief hide for chrome geometry jumps. panelId scopes so siblings don't flash. */
export function pulseTerminalSurfaceSuppression(
  id = "chrome-geometry",
  panelId?: string
): void {
  if (resizeSuppressActive) {
    flushTerminalLayoutFramesTrailing("visibility");
    return;
  }
  const release = acquireTerminalSurfaceSuppression(id, panelId);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      release();
      flushTerminalLayoutFramesTrailing("visibility");
    });
  });
}
/** Test-only: drop holders / resize suppress bits left between cases. */
export function resetTerminalSurfaceSuppressionForTests(): void {
  clearResizeFallback();
  awaitingRestoreAck = false;
  clearTimeout(restoreAckTimer ?? undefined);
  restoreAckTimer = null;
  resizeSuppressActive = false;
  suppressHolders.clear();
  useTerminalStore.setState({
    placeholderVisible: false,
    suppressTerminals: false,
    suppressedPanelIds: new Set(),
  });
}
function enterResizeSuppression(): void {
  // 拖拽持续 → 每个 active 帧续期兜底计时。
  clearResizeFallback();
  resizeFallbackTimer = window.setTimeout(
    exitResizeSuppression,
    RESIZE_FALLBACK_MS
  );
  // 已在 resize 隐身：后续 active 帧只续期，不重复下发。
  if (resizeSuppressActive) {
    return;
  }
  resizeSuppressActive = true;
  syncSurfaceSuppression({ showPlaceholder: true });
}
function exitResizeSuppression(): void {
  clearResizeFallback();
  // 未在 resize 隐身（已恢复或从未进入）：幂等空操作。
  if (!resizeSuppressActive) {
    return;
  }
  resizeSuppressActive = false;
  syncSurfaceSuppression();
}

// native 同步应用某帧后回的「就位」ack。当其 sequence 追上 renderer 最新下发
// （含 trailing flush 补的最终 frame），说明终端几何已落位，可安全撤占位。
function handleRestoreAck(rendererSequence: number): void {
  if (!awaitingRestoreAck) {
    return;
  }
  if (rendererSequence >= useTerminalStore.getState().lastDownlinkSequence) {
    dismissResizePlaceholder();
  }
}
function handleResizePhase(phase: WindowLayoutPulse["phase"]): void {
  if (phase === "active") {
    enterResizeSuppression();
    return;
  }
  // 'end'，以及任何缺失/未知 phase：一律收尾恢复，绝不静默卡在隐身。
  exitResizeSuppression();
}
function ensureGlobalListeners(): void {
  if (!windowResizeInstalled) {
    window.addEventListener("resize", handleWindowResize);
    windowResizeInstalled = true;
  }
  if (!windowLayoutPulseDispose) {
    windowLayoutPulseDispose =
      window.pier?.window?.onLayoutPulse?.((pulse) => {
        if (
          pulse.reason === "view-zoom" &&
          typeof pulse.windowZoomLevel === "number"
        ) {
          useZoomStore.setState({ windowZoomLevel: pulse.windowZoomLevel });
        }
        if (pulse.reason === "resize") {
          handleResizePhase(pulse.phase);
          // active 期间终端隐身，无需 flush 终端 frame（end 才补最终位置）。
          if (pulse.phase === "active") {
            return;
          }
        } else if (pulse.reason === "zoom") {
          // maximize/unmaximize/全屏完成：动画期可能已被 'resize'→active 藏过终端，
          // 而 zoom 不带 end。这里收尾恢复，避免终端卡在隐身。
          exitResizeSuppression();
        }
        flushTerminalLayoutFramesTrailing(`window-${pulse.reason}`);
      }) ?? null;
  }
  if (!presentationAppliedDispose) {
    presentationAppliedDispose =
      window.pier?.terminal?.onPresentationApplied?.((payload) => {
        handleRestoreAck(payload.rendererSequence);
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
  presentationAppliedDispose?.();
  presentationAppliedDispose = null;
  // 最后一个终端卸载：清理 resize 隐身的挂起计时器并复位 store，
  // 避免悬挂回调在 listener 移除后触发、或 store 残留隐身态。
  clearResizeFallback();
  awaitingRestoreAck = false;
  if (restoreAckTimer !== null) {
    clearTimeout(restoreAckTimer);
    restoreAckTimer = null;
  }
  resizeSuppressActive = false;
  suppressHolders.clear();
  const terminalState = useTerminalStore.getState();
  if (
    terminalState.suppressTerminals ||
    terminalState.suppressedPanelIds.size > 0 ||
    terminalState.placeholderVisible
  ) {
    useTerminalStore.setState({
      placeholderVisible: false,
      suppressTerminals: false,
      suppressedPanelIds: new Set(),
    });
  }
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
