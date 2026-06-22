/**
 * Window IPC handlers — renderer 通过 pier://window:* 调用.
 *
 * 参考 loomdesk 精简: 保留 create/list/focus/close + closeCurrent
 * (closeCurrent 用 sender window, renderer 无需传 windowId).
 */

import { PIER } from "@shared/ipc-channels.ts";
import { BrowserWindow, type IpcMain } from "electron";
import { windowManager } from "../windows/window-manager.ts";

export function registerWindowIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.WINDOW_CREATE, () => {
    const id = windowManager.create();
    return { windowId: id };
  });

  ipcMain.handle(PIER.WINDOW_LIST, () => windowManager.list());

  ipcMain.handle(PIER.WINDOW_FOCUS, (_event, windowId: string) => {
    windowManager.focus(windowId);
  });

  ipcMain.handle(PIER.WINDOW_CLOSE, (_event, windowId: string) => {
    windowManager.close(windowId);
  });

  ipcMain.handle(PIER.WINDOW_CLOSE_CURRENT, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    const internalId = windowManager.findInternalIdByBrowserWindow(win);
    if (internalId) {
      windowManager.close(internalId);
    }
  });
}
