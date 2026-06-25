/**
 * Overlay / drag ref 计数器。
 *
 * EventRouterView 在计数 > 0 时把所有事件交给 web 层:
 *   - web overlay (command palette / dialog): pushOverlay / popOverlay
 *   - dockview drag (tab 拖拽 / sash 调整): installDragWatcher 自动管理
 */
let overlayCount = 0;
const TAB_DRAG_FALLBACK_MS = 5000;
const DRAG_WATCHER_CLEANUP_KEY = "__pierTerminalDragWatcherCleanup__";

interface DragWatcherDocument extends Document {
  [DRAG_WATCHER_CLEANUP_KEY]?: () => void;
}

export function pushOverlay(): void {
  if (++overlayCount === 1) {
    window.pier?.terminal?.setOverlayActive?.(true);
  }
}

export function popOverlay(): void {
  overlayCount = Math.max(0, overlayCount - 1);
  if (overlayCount === 0) {
    window.pier?.terminal?.setOverlayActive?.(false);
  }
}

/**
 * 全局拖拽监听: 在 dockview tab (HTML5 drag) / sash (pointer drag) 启动时 push overlay,
 * 结束时 pop。确保拖拽期间 EventRouter 不截获事件, 让 web 层 drop overlay / sash
 * 高亮能接收输入并稳定显示在 terminal 上方。
 *
 * 两套独立监听 (HTML5 drag 与 pointer drag 是不同事件流):
 *   - dragstart/dragend: tab 拖拽 (dockview 走 HTML5 drag API)
 *   - pointerdown + pointerup/cancel: sash 拖拽 (resize handles, 不走 HTML5 drag)
 */
let dragWatcherInstalled = false;

export function installDragWatcher(): void {
  if (dragWatcherInstalled) {
    return;
  }
  const watcherDocument = document as DragWatcherDocument;
  watcherDocument[DRAG_WATCHER_CLEANUP_KEY]?.();
  dragWatcherInstalled = true;

  // HTML5 drag (tab): dragstart 是 panel/tab 拖拽的唯一可靠信号, pointerdown 在
  // Electron + macOS 上不一定能可靠触达 web (mouse events 被 EventRouter / NSView 抢)
  let dragActive = false;
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
    popOverlay();
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
    pushOverlay();
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

  // Sash / resize handle 走 pointer events, 没有 HTML5 drag
  let sashDragActive = false;
  let endSashDrag: (() => void) | null = null;
  const beginSashDrag = () => {
    if (sashDragActive) {
      return;
    }
    sashDragActive = true;
    pushOverlay();
    const cleanup = () => {
      if (!sashDragActive) {
        return;
      }
      sashDragActive = false;
      popOverlay();
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
