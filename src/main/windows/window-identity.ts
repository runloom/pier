import type { BrowserWindow } from "electron";

const browserWindowIds = new WeakMap<BrowserWindow, string>();

export function rememberBrowserWindowId(
  window: BrowserWindow,
  id: string
): void {
  browserWindowIds.set(window, id);
}

export function forgetBrowserWindowId(window: BrowserWindow): void {
  browserWindowIds.delete(window);
}

export function findBrowserWindowId(window: BrowserWindow): string | null {
  return browserWindowIds.get(window) ?? null;
}
