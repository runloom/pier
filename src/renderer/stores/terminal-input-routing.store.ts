import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

interface WebKeyboardOwner {
  transient: boolean;
}

interface WebOverlayRegistration {
  dispose(): void;
  flush(): void;
}

const webOverlayRects = new Map<string, TerminalFrame>();
const webKeyboardOwners = new Map<string, WebKeyboardOwner>();

let baseKeyboardFocusTarget: TerminalKeyboardFocusTarget = { kind: "web" };
let rendererSequence = 0;
let lastSnapshot: TerminalInputRoutingSnapshot | null = null;

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function sameKeyboardFocusTarget(
  a: TerminalKeyboardFocusTarget,
  b: TerminalKeyboardFocusTarget
): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "web" || (b.kind === "terminal" && a.panelId === b.panelId))
  );
}

function effectiveKeyboardFocusTarget(): TerminalKeyboardFocusTarget {
  return webKeyboardOwners.size > 0 ? { kind: "web" } : baseKeyboardFocusTarget;
}

function applyTerminalInputRouting(): void {
  rendererSequence += 1;
  const snapshot: TerminalInputRoutingSnapshot = {
    keyboardFocusTarget: effectiveKeyboardFocusTarget(),
    rendererSequence,
    webOverlayRects: Array.from(webOverlayRects, ([id, frame]) => ({
      frame,
      id,
    })),
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

export function setTerminalBaseKeyboardFocusTarget(
  target: TerminalKeyboardFocusTarget
): void {
  if (sameKeyboardFocusTarget(baseKeyboardFocusTarget, target)) {
    return;
  }
  baseKeyboardFocusTarget = target;
  applyTerminalInputRouting();
}

export function holdTerminalWebKeyboardFocus(
  id: string,
  options: { transient?: boolean } = {}
): () => void {
  const previous = webKeyboardOwners.get(id);
  const next: WebKeyboardOwner = { transient: options.transient ?? false };
  webKeyboardOwners.set(id, next);
  if (!previous || previous.transient !== next.transient) {
    applyTerminalInputRouting();
  }
  return () => {
    if (!webKeyboardOwners.has(id)) {
      return;
    }
    webKeyboardOwners.delete(id);
    applyTerminalInputRouting();
  };
}

export function releaseTransientTerminalWebKeyboardFocus(): void {
  let changed = false;
  for (const [id, owner] of webKeyboardOwners) {
    if (owner.transient) {
      webKeyboardOwners.delete(id);
      changed = true;
    }
  }
  if (changed) {
    applyTerminalInputRouting();
  }
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
  const releaseKeyboard = holdTerminalWebKeyboardFocus(id);
  return () => {
    releaseKeyboard();
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
  webKeyboardOwners.clear();
  baseKeyboardFocusTarget = { kind: "web" };
  rendererSequence = 0;
  lastSnapshot = null;
  dragWatcherInstalled = false;
}
