import type { WindowContext } from "@shared/contracts/window.ts";
import type { WebContents } from "electron";
import type { AppWindow } from "./app-window.ts";

const appWindowIds = new WeakMap<AppWindow, string>();
const appWindowContexts = new WeakMap<AppWindow, WindowContext>();
const appWindowElectronIds = new WeakMap<AppWindow, number>();
const appWindowsByElectronId = new Map<number, AppWindow>();
const appWindowsByWebContents = new WeakMap<WebContents, AppWindow>();

export function rememberAppWindow(
  window: AppWindow,
  context: WindowContext
): void {
  const electronId = window.id;
  appWindowIds.set(window, context.windowId);
  appWindowContexts.set(window, context);
  appWindowElectronIds.set(window, electronId);
  appWindowsByElectronId.set(electronId, window);
  appWindowsByWebContents.set(window.webContents, window);
}

export function forgetAppWindow(window: AppWindow): void {
  appWindowIds.delete(window);
  appWindowContexts.delete(window);
  const electronId = appWindowElectronIds.get(window);
  if (electronId !== undefined) {
    appWindowsByElectronId.delete(electronId);
    appWindowElectronIds.delete(window);
  }
}

export function findInternalWindowId(window: AppWindow): string | null {
  return appWindowIds.get(window) ?? null;
}

export function findWindowContext(window: AppWindow): WindowContext | null {
  return appWindowContexts.get(window) ?? null;
}

export function findAppWindowByElectronId(id: number): AppWindow | null {
  return appWindowsByElectronId.get(id) ?? null;
}

export function findAppWindowByWebContents(
  webContents: WebContents
): AppWindow | null {
  return appWindowsByWebContents.get(webContents) ?? null;
}
