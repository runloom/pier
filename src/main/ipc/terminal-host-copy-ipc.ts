import type { IpcMain } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";

/**
 * Host-copy catalog / injectDisplayText IPC (Ghostty end-state + paste confirm).
 */
export function registerTerminalHostCopyIpc(args: {
  addon: NativeAddon | null;
  ipcMain: IpcMain;
  windowFromWebContents: (sender: Electron.WebContents) => AppWindow | null;
}): void {
  const { addon, ipcMain, windowFromWebContents } = args;

  ipcMain.handle(
    "pier:terminal:set-host-language",
    (_event, languageTag: unknown) => {
      if (typeof languageTag !== "string") {
        return { ok: false as const, error: "languageTag must be a string" };
      }
      try {
        addon?.setHostLanguage?.(languageTag);
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );

  ipcMain.handle(
    "pier:terminal:set-host-copy-catalog",
    (_event, messages: unknown) => {
      if (
        !messages ||
        typeof messages !== "object" ||
        Array.isArray(messages)
      ) {
        return { ok: false as const, error: "messages must be an object" };
      }
      try {
        const json = JSON.stringify(messages);
        addon?.setHostCopyCatalog?.(json);
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );

  ipcMain.handle(
    "pier:terminal:inject-display-text",
    (event, panelId: unknown, text: unknown) => {
      if (typeof panelId !== "string" || panelId.length === 0) {
        return { ok: false as const, error: "panelId required" };
      }
      if (typeof text !== "string" || text.length === 0) {
        return { ok: false as const, error: "text required" };
      }
      const win = windowFromWebContents(event.sender);
      if (!win) {
        return { ok: false as const, error: "window not found" };
      }
      if (!addon?.injectDisplayText) {
        return { ok: false as const, error: "injectDisplayText unavailable" };
      }
      try {
        const nativePanelId = toNativePanelKey(win, panelId);
        const ok = addon.injectDisplayText(nativePanelId, text);
        return ok
          ? { ok: true as const }
          : { ok: false as const, error: "inject failed" };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
}
