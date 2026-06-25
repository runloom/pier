import type { AppWindow } from "../windows/app-window.ts";

/**
 * 给 panelId 加 AppWindow scope 前缀, 让 swift 端 `terminals: [String: Terminal]`
 * 单一 dict 能区分跨窗口同名 panel.
 */
const PANEL_ID_SEPARATOR = "::";

export function scopePanelId(win: AppWindow, panelId: string): string {
  return `${win.id}${PANEL_ID_SEPARATOR}${panelId}`;
}

export function unscopePanelId(scopedId: string): string {
  const idx = scopedId.indexOf(PANEL_ID_SEPARATOR);
  return idx === -1
    ? scopedId
    : scopedId.slice(idx + PANEL_ID_SEPARATOR.length);
}
