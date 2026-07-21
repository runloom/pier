import { join } from "node:path";
import {
  NATIVE_CHROME_FALLBACK,
  TRANSPARENT_NATIVE_BACKGROUND,
} from "@shared/theme-colors.ts";
import { BaseWindow, BrowserWindow, WebContentsView } from "electron";
import { isDevRuntime } from "../runtime-mode.ts";
import { type AppWindow, createAppWindow } from "./app-window.ts";
import { installMacAppViewGeometry } from "./mac-app-view-geometry.ts";

const isDev = isDevRuntime();
const isMac = process.platform === "darwin";

export function resolveDevIcon(): string | undefined {
  return isDev ? join(import.meta.dirname, "../../build/icon.png") : undefined;
}

export function createManagedMacWindow(
  baseOpts: Electron.BaseWindowConstructorOptions,
  webPreferences: Electron.WebPreferences
): AppWindow {
  const host = new BaseWindow(baseOpts);
  const appView = new WebContentsView({ webPreferences });
  appView.setBackgroundColor(TRANSPARENT_NATIVE_BACKGROUND);
  host.contentView.addChildView(appView);
  installMacAppViewGeometry(host, appView);
  return createAppWindow(host, appView.webContents, appView);
}

export function createManagedBrowserWindow(
  baseOpts: Electron.BaseWindowConstructorOptions,
  webPreferences: Electron.WebPreferences,
  devIcon: string | undefined
): AppWindow {
  const browserOpts: Electron.BrowserWindowConstructorOptions = {
    ...baseOpts,
    ...(devIcon ? { icon: devIcon } : {}),
    webPreferences,
  };
  const host = new BrowserWindow(browserOpts);
  return createAppWindow(host, host.webContents, null);
}

export function buildBaseWindowOptions(input: {
  bounds?: { height?: number; width?: number; x?: number; y?: number };
  resolved: "dark" | "light";
}): Electron.BaseWindowConstructorOptions {
  const baseOpts: Electron.BaseWindowConstructorOptions = {
    width: input.bounds?.width ?? 1280,
    height: input.bounds?.height ?? 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: NATIVE_CHROME_FALLBACK[input.resolved],
    ...(isMac && {
      opacity: 0,
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 12, y: 12 },
    }),
  };
  if (input.bounds?.x !== undefined) baseOpts.x = input.bounds.x;
  if (input.bounds?.y !== undefined) baseOpts.y = input.bounds.y;
  return baseOpts;
}

export { isDev, isMac };
