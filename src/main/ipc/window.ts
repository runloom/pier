/**
 * Window IPC handlers — renderer 通过 pier://window:* 调用.
 *
 * 参考 loomdesk 精简: 保留 create/list/focus/close + closeCurrent
 * (closeCurrent 用 sender window, renderer 无需传 windowId).
 */

import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";

export function registerWindowIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.WINDOW_CREATE, () => appCore.services.window.create());

  ipcMain.handle(PIER.WINDOW_LIST, () => appCore.services.window.list());

  ipcMain.handle(PIER.WINDOW_FOCUS, (_event, windowId: string) => {
    appCore.services.window.focus(windowId);
  });

  ipcMain.handle(PIER.WINDOW_CLOSE, (_event, windowId: string) => {
    appCore.services.window.close(windowId);
  });

  ipcMain.handle(PIER.WINDOW_CLOSE_CURRENT, (event) => {
    const win = windowManager.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    const internalId = windowManager.findInternalIdByWindow(win);
    if (internalId) {
      windowManager.close(internalId);
    }
  });
}
