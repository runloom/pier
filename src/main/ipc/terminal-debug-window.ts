import { join } from "node:path";
import type { TerminalDebugWindowOpenResult } from "@shared/contracts/terminal-debug.ts";
import { BrowserWindow, type IpcMain } from "electron";
import { isDevRuntime } from "../runtime-mode.ts";
import { createAppWindow } from "../windows/app-window.ts";
import {
  installRendererFailureRecovery,
  reportRendererLoadError,
} from "../windows/renderer-failure-recovery.ts";
import { createRendererShowGate } from "../windows/renderer-show-gate.ts";
import { windowFromWebContents } from "./terminal.ts";

const isDev = isDevRuntime();
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

export function registerTerminalDebugWindowIpc(
  ipcMain: IpcMain,
  options: { isQuitting(): boolean }
): void {
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
      const appWindow = createAppWindow(
        debugWindow,
        debugWindow.webContents,
        null
      );
      const showGate = createRendererShowGate({
        recordId: `terminal-debug-${debugWindow.id}`,
        showInactive: true,
        window: appWindow,
        windowId: `terminal-debug-${debugWindow.id}`,
      });
      const recovery = installRendererFailureRecovery({
        beforeLoadFailure: showGate.cancel,
        beforeRendererGone: showGate.cancel,
        isQuitting: options.isQuitting,
        retryRenderer: showGate.retry,
        window: appWindow,
      });
      showGate.setReadyTimeoutHandler(() => {
        recovery.report({
          detail:
            "terminal debug renderer did not boot before the startup deadline",
          kind: "load",
        });
      });
      debugWindow.on("closed", () => {
        showGate.cancel();
        openDebugWindows.delete(debugWindow);
      });

      const url = isDev ? debugRendererUrl(targetWindow.id) : null;
      if (url) {
        debugWindow.loadURL(url).catch((error: unknown) => {
          reportRendererLoadError(recovery, error);
        });
      } else {
        debugWindow
          .loadFile(join(import.meta.dirname, "../renderer/index.html"), {
            query: {
              pierDebug: "terminal",
              targetBrowserWindowId: String(targetWindow.id),
            },
          })
          .catch((error: unknown) => {
            reportRendererLoadError(recovery, error);
          });
      }

      return {
        ok: true,
        targetBrowserWindowId: targetWindow.id,
      };
    }
  );
}
