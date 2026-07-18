import { clipboard, type IpcMain } from "electron";

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
    clipboard.writeText(text);
  });
}
