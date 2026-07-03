import type { AppWindow } from "../windows/app-window.ts";

/**
 * 给 panelId 加 AppWindow scope 前缀, 让 swift 端 `terminals: [String: Terminal]`
 * 单一 dict 能区分跨窗口同名 panel.
 */
const PANEL_ID_SEPARATOR = "::";

export function toNativePanelKey(win: AppWindow, panelId: string): string {
  return `${win.id}${PANEL_ID_SEPARATOR}${panelId}`;
}

export function fromNativePanelKey(nativeKey: string): string {
  const idx = nativeKey.indexOf(PANEL_ID_SEPARATOR);
  return idx === -1
    ? nativeKey
    : nativeKey.slice(idx + PANEL_ID_SEPARATOR.length);
}
