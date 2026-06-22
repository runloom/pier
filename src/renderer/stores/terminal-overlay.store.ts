/**
 * Overlay ref 计数器。
 *
 * web overlay (command palette / dialog 等) 打开时调 pushOverlay(),
 * 关闭时调 popOverlay()。计数归零时通知 native 层恢复终端事件路由。
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
