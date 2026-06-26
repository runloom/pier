import { findAppWindowByElectronId } from "../windows/window-identity.ts";

/**
 * Forward swift-originated event to a specific app window renderer.
 *
 * 所有 swift→main→renderer forward 共用这一条路由:
 * 1. 按 Electron window id 精准定位 app window, 不依赖 focused window.
 * 2. 守 isDestroyed, 避免 window/webContents 关闭瞬间抛错.
 * 3. send 抛错只记录, 不影响其他 native callback.
 */
export function forwardToWindow<P>(
  browserWindowId: number,
  channel: string,
  payload: P,
  errorLabel: string
): void {
  try {
    const targetWindow = findAppWindowByElectronId(browserWindowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const wc = targetWindow.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    wc.send(channel, payload);
  } catch (err) {
    console.error(`[${errorLabel}] send failed:`, err);
  }
}
