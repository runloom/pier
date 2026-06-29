import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { sameKeyboardFocusTarget as sameBasePanel } from "@shared/terminal-keyboard-target.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

interface WebOverlayRegistration {
  dispose(): void;
  flush(): void;
}

const webOverlayRects = new Map<string, TerminalFrame>();
const webRequestIds = new Set<string>();

let basePanel: TerminalKeyboardFocusTarget = { kind: "web" };
let rendererSequence = 0;
let lastSnapshot: TerminalInputRoutingSnapshot | null = null;

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function applyTerminalInputRouting(): void {
  rendererSequence += 1;
  const snapshot: TerminalInputRoutingSnapshot = {
    basePanel,
    rendererSequence,
    webOverlayRects: Array.from(webOverlayRects, ([id, frame]) => ({
      frame,
      id,
    })),
    webRequestCount: webRequestIds.size,
  };
  lastSnapshot = snapshot;
  window.pier?.terminal?.applyInputRouting?.(snapshot);
}

function setWebOverlayRect(id: string, frame: TerminalFrame | null): void {
  const previous = webOverlayRects.get(id);
  if (!frame) {
    if (!previous) {
      return;
    }
    webOverlayRects.delete(id);
    applyTerminalInputRouting();
    return;
  }
  if (previous && frameKey(previous) === frameKey(frame)) {
    return;
  }
  webOverlayRects.set(id, frame);
  applyTerminalInputRouting();
}

function cssDomRectToTerminalFrame(rect: DOMRect): TerminalFrame | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return cssRectToContentViewRect(
    {
      height: rect.height,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    },
    useZoomStore.getState().windowZoomLevel
  );
}

export function getLastTerminalInputRoutingSnapshot(): TerminalInputRoutingSnapshot | null {
  return lastSnapshot;
}

export function setTerminalBasePanel(
  target: TerminalKeyboardFocusTarget
): void {
  if (sameBasePanel(basePanel, target)) {
    return;
  }
  basePanel = target;
  applyTerminalInputRouting();
}

/**
 * 浮在终端上的 web 元素声明一次键盘焦点意图。任意活跃请求即把 effective 拉成
 * web。返回的释放函数 idempotent —— 多次调用只在首次真正移除请求时重算。
 */
export function requestTerminalWebFocus(id: string): () => void {
  if (!webRequestIds.has(id)) {
    webRequestIds.add(id);
    applyTerminalInputRouting();
  }
  return () => {
    if (webRequestIds.delete(id)) {
      applyTerminalInputRouting();
    }
  };
}

export function registerTerminalElementWebOverlay(
  id: string,
  element: HTMLElement
): WebOverlayRegistration {
  let frameRequest: number | null = null;

  const flush = () => {
    setWebOverlayRect(
      id,
      cssDomRectToTerminalFrame(element.getBoundingClientRect())
    );
  };

  const flushTrailing = () => {
    flush();
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
    }
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      flush();
    });
  };

  const resizeObserver = new ResizeObserver(flushTrailing);
  resizeObserver.observe(element);
  window.addEventListener("resize", flushTrailing);
  const disposePulse =
    window.pier?.onWindowLayoutPulse?.((_pulse: WindowLayoutPulse) => {
      flushTrailing();
    }) ?? null;
  flushTrailing();

  return {
    dispose() {
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", flushTrailing);
      disposePulse?.();
      setWebOverlayRect(id, null);
    },
    flush,
  };
}

export function registerTerminalFullscreenWebOverlay(
  id: string
): WebOverlayRegistration {
  let frameRequest: number | null = null;

  const flush = () => {
    setWebOverlayRect(id, readTerminalViewportFrame());
  };

  const flushTrailing = () => {
    flush();
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
    }
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      flush();
    });
  };

  const onWindowLayoutPulse = (pulse: WindowLayoutPulse) => {
    if (
      pulse.reason === "view-zoom" &&
      typeof pulse.windowZoomLevel === "number"
    ) {
      useZoomStore.setState({ windowZoomLevel: pulse.windowZoomLevel });
    }
    flushTrailing();
  };

  window.addEventListener("resize", flushTrailing);
  const disposePulse =
    window.pier?.onWindowLayoutPulse?.(onWindowLayoutPulse) ?? null;
  flushTrailing();

  return {
    dispose() {
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      window.removeEventListener("resize", flushTrailing);
      disposePulse?.();
      setWebOverlayRect(id, null);
    },
    flush,
  };
}

const TAB_DRAG_FALLBACK_MS = 5000;
const DRAG_WATCHER_CLEANUP_KEY = "__pierTerminalInputRoutingDragCleanup__";

interface DragWatcherDocument extends Document {
  [DRAG_WATCHER_CLEANUP_KEY]?: () => void;
}

function beginFullscreenWebInputCapture(id: string): () => void {
  const route = registerTerminalFullscreenWebOverlay(id);
  const releaseWebFocus = requestTerminalWebFocus(id);
  return () => {
    releaseWebFocus();
    route.dispose();
  };
}

let dragWatcherInstalled = false;

export function installTerminalInputRoutingDragWatcher(): void {
  if (dragWatcherInstalled) {
    return;
  }
  const watcherDocument = document as DragWatcherDocument;
  watcherDocument[DRAG_WATCHER_CLEANUP_KEY]?.();
  dragWatcherInstalled = true;

  let dragActive = false;
  let endDragCapture: (() => void) | null = null;
  let dragFallbackTimer: number | null = null;

  const clearDragFallback = () => {
    if (dragFallbackTimer === null) {
      return;
    }
    window.clearTimeout(dragFallbackTimer);
    dragFallbackTimer = null;
  };

  const endTabDrag = () => {
    if (!dragActive) {
      return;
    }
    dragActive = false;
    clearDragFallback();
    endDragCapture?.();
    endDragCapture = null;
  };

  const armDragFallback = () => {
    clearDragFallback();
    dragFallbackTimer = window.setTimeout(endTabDrag, TAB_DRAG_FALLBACK_MS);
  };

  const beginTabDrag = () => {
    if (dragActive) {
      return;
    }
    dragActive = true;
    endDragCapture = beginFullscreenWebInputCapture("dockview-tab-drag");
    armDragFallback();
  };

  const onDragStart = (e: DragEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.(".dv-tab")) {
      return;
    }
    beginTabDrag();
  };

  const onDrop = () => {
    if (!dragActive) {
      return;
    }
    window.setTimeout(endTabDrag, 0);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      endTabDrag();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      endTabDrag();
    }
  };

  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragend", endTabDrag, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("visibilitychange", onVisibilityChange, true);
  window.addEventListener("blur", endTabDrag);
  window.addEventListener("keydown", onKeyDown, true);

  let sashDragActive = false;
  let endSashDrag: (() => void) | null = null;
  const beginSashDrag = () => {
    if (sashDragActive) {
      return;
    }
    sashDragActive = true;
    const endSashCapture = beginFullscreenWebInputCapture("dockview-sash-drag");
    const cleanup = () => {
      if (!sashDragActive) {
        return;
      }
      sashDragActive = false;
      endSashCapture();
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      endSashDrag = null;
    };
    endSashDrag = cleanup;
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!(t.closest(".dv-sash") || t.closest(".dv-resize-container"))) {
      return;
    }
    beginSashDrag();
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  watcherDocument[DRAG_WATCHER_CLEANUP_KEY] = () => {
    endTabDrag();
    endSashDrag?.();
    clearDragFallback();
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragend", endTabDrag, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", endTabDrag);
    window.removeEventListener("keydown", onKeyDown, true);
    dragWatcherInstalled = false;
    delete watcherDocument[DRAG_WATCHER_CLEANUP_KEY];
  };
}

export function resetTerminalInputRoutingForTests(): void {
  webOverlayRects.clear();
  webRequestIds.clear();
  basePanel = { kind: "web" };
  rendererSequence = 0;
  lastSnapshot = null;
  dragWatcherInstalled = false;
}
