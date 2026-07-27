import { MENU_LIMITS } from "@shared/contracts/menu.ts";
import { clipboard, type IpcMain } from "electron";
import {
  beginClipboardImageSuppress,
  endClipboardImageSuppress,
} from "./clipboard-image-suppress.ts";

/**
 * Renderer 经 preload 写系统剪贴板。
 * 原生菜单点击后 navigator.clipboard 在部分环境下会静默失败或写不进系统剪贴板，
 * 因此复制选区走 main clipboard.writeText。
 */
export function registerClipboardIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:clipboard:writeText", (_event, text: unknown) => {
    if (typeof text !== "string") {
      throw new Error("clipboard text must be a string");
    }
    if (text.length > MENU_LIMITS.clipboardTextMaxLength) {
      throw new Error(
        `clipboard text exceeds ${MENU_LIMITS.clipboardTextMaxLength} characters`
      );
    }
    clipboard.writeText(text);
  });

  // Agent TUI enhanced-input send: drop clipboard raster so Grok does not
  // attach a leftover screenshot on short bracketed pastes (e.g. "你好").
  ipcMain.handle("pier:clipboard:beginImageSuppress", () => {
    beginClipboardImageSuppress();
  });
  ipcMain.handle("pier:clipboard:endImageSuppress", () => {
    endClipboardImageSuppress();
  });
}
