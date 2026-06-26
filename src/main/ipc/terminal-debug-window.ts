import { join } from "node:path";
import type { TerminalDebugWindowOpenResult } from "@shared/contracts/terminal.ts";
import { app, BrowserWindow, type IpcMain } from "electron";
import { windowFromWebContents } from "./terminal.ts";

const isDev = !app.isPackaged;
const openDebugWindows = new Set<BrowserWindow>();

function debugRendererUrl(targetBrowserWindowId: number): string | null {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!rendererUrl) {
    return null;
  }
  const url = new URL(rendererUrl);
  url.searchParams.set("pierDebug", "terminal");
  url.searchParams.set("targetBrowserWindowId", String(targetBrowserWindowId));
  return url.toString();
}

export function registerTerminalDebugWindowIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:terminal-debug:open-window",
    (event): TerminalDebugWindowOpenResult => {
      const targetWindow = windowFromWebContents(event.sender);
      if (!targetWindow) {
        return { ok: false, error: "target window not found" };
      }

      const preload = join(import.meta.dirname, "../preload/index.cjs");
      const debugWindow = new BrowserWindow({
        autoHideMenuBar: true,
        height: 760,
        show: false,
        title: `Pier Terminal Debug - ${targetWindow.id}`,
        webPreferences: {
          additionalArguments: [
            "--pier-debug-window=terminal",
            `--pier-debug-target=${targetWindow.id}`,
          ],
          contextIsolation: true,
          nodeIntegration: false,
          preload,
          sandbox: true,
        },
        width: 1120,
      });
      openDebugWindows.add(debugWindow);
      debugWindow.on("closed", () => {
        openDebugWindows.delete(debugWindow);
      });

      debugWindow.once("ready-to-show", () => {
        debugWindow.showInactive();
      });

      const url = isDev ? debugRendererUrl(targetWindow.id) : null;
      if (url) {
        debugWindow.loadURL(url).catch(() => undefined);
      } else {
        debugWindow
          .loadFile(join(import.meta.dirname, "../renderer/index.html"), {
            query: {
              pierDebug: "terminal",
              targetBrowserWindowId: String(targetWindow.id),
            },
          })
          .catch(() => undefined);
      }

      return {
        ok: true,
        targetBrowserWindowId: targetWindow.id,
      };
    }
  );
}
