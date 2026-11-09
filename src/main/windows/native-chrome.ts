import type { AppWindow } from "./app-window.ts";

/**
 * macOS 原生 chrome 兜底色必须同时写到窗口与 WebContentsView backing。
 *
 * WebContentsView 若是透明 backing，Chromium 的部分重绘（buffer age /
 * partial swap）会把新帧的透明区域混合在旧帧像素上，终端状态栏这类
 * 「透明底 + 局部重绘」的区域会残留缩放前的旧文字（2026-11-09 复现）。
 * 终端可见性由 TerminalHoleMask 硬裁保证，web 表面不再承担「透明透出
 * native terminal」职责，所以这里必须使用不透明色。
 */
export function setNativeWindowChromeColor(
  window: AppWindow,
  color: string
): void {
  window.setBackgroundColor(color);
  const appView = window.appView;
  if (appView && !appView.webContents.isDestroyed()) {
    appView.setBackgroundColor(color);
  }
}
