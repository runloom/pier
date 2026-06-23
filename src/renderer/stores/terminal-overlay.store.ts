/**
 * Overlay / drag ref 计数器。
 *
 * EventRouterView 在计数 > 0 时把所有事件交给 web 层:
 *   - web overlay (command palette / dialog): pushOverlay / popOverlay
 *   - dockview drag (tab 拖拽 / sash 调整): installDragWatcher 自动管理
 */
let overlayCount = 0;

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
 * 结束时 pop。确保拖拽期间 EventRouter 不截获事件, 并隐藏 terminal NSView 让 web
 * 层 drop overlay / sash 高亮可见。
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
  dragWatcherInstalled = true;

  // HTML5 drag (tab): dragstart 是 panel/tab 拖拽的唯一可靠信号, pointerdown 在
  // Electron + macOS 上不一定能可靠触达 web (mouse events 被 EventRouter / NSView 抢)
  let dragActive = false;
  document.addEventListener(
    "dragstart",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".dv-tab")) {
        return;
      }
      if (dragActive) {
        return;
      }
      dragActive = true;
      pushOverlay();
    },
    true
  );
  document.addEventListener(
    "dragend",
    () => {
      if (!dragActive) {
        return;
      }
      dragActive = false;
      popOverlay();
    },
    true
  );

  // Sash / resize handle 走 pointer events, 没有 HTML5 drag
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as HTMLElement;
      if (!(t.closest(".dv-sash") || t.closest(".dv-resize-container"))) {
        return;
      }
      pushOverlay();
      const cleanup = () => {
        popOverlay();
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
      };
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    true
  );
}
