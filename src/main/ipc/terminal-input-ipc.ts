import type { TerminalSelectionTextResult } from "@shared/contracts/terminal.ts";
import type { IpcMain, WebContents } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import {
  performTerminalOperation,
  readTerminalSelectionText,
  sendTerminalKeyPress,
  sendTerminalText,
} from "./terminal-operations.ts";

/**
 * Composer / clipboard 输入类 IPC：perform-operation、send-text、
 * send-key-press、read-selection-text。从 terminal.ts 抽出以守 file-size 硬顶。
 */
export function registerTerminalInputIpc(opts: {
  addon: NativeAddon | null;
  ipcMain: IpcMain;
  loadError: string | null;
  windowFromWebContents: (webContents: WebContents) => AppWindow | null;
}): void {
  const { addon, ipcMain, loadError, windowFromWebContents } = opts;

  ipcMain.handle(
    "pier:terminal:perform-operation",
    (event, panelId: unknown, operation: unknown) =>
      performTerminalOperation({
        addon,
        loadError,
        operation,
        panelId,
        win: windowFromWebContents(event.sender),
      })
  );

  ipcMain.handle("pier:terminal:send-text", (event, args: unknown) =>
    sendTerminalText({
      addon,
      args,
      loadError,
      win: windowFromWebContents(event.sender),
    })
  );

  ipcMain.handle("pier:terminal:send-key-press", (event, args: unknown) =>
    sendTerminalKeyPress({
      addon,
      args,
      loadError,
      win: windowFromWebContents(event.sender),
    })
  );

  ipcMain.handle(
    "pier:terminal:read-selection-text",
    (event, panelId: unknown) =>
      Promise.resolve().then(() => {
        const trimmedPanelId =
          typeof panelId === "string" ? panelId.trim() : "";
        if (!trimmedPanelId) {
          return { kind: "empty" } satisfies TerminalSelectionTextResult;
        }
        const win = windowFromWebContents(event.sender);
        if (!win) {
          return {
            kind: "error",
            message: "Terminal window is not available.",
          } satisfies TerminalSelectionTextResult;
        }
        try {
          const text = readTerminalSelectionText({
            addon,
            loadError,
            panelId: trimmedPanelId,
            win,
          });
          if (!text) {
            return { kind: "empty" } satisfies TerminalSelectionTextResult;
          }
          return { kind: "ok", text } satisfies TerminalSelectionTextResult;
        } catch (err) {
          return {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          } satisfies TerminalSelectionTextResult;
        }
      })
  );
}
