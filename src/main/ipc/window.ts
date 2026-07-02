/**
 * Window IPC handlers — renderer 通过 pier://window:* 调用.
 *
 * 保留 context 和 closeCurrent:
 * - context: 需要 sender window 从 windowManager 查询，无对应 PierCommand
 * - closeCurrent: 用 sender window，renderer 无需传 windowId，无对应 PierCommand
 * 已迁至 command router: close/create/focus/list
 */

import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { findWindowContext } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";

export function registerWindowIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.WINDOW_CONTEXT, (event) => {
    const win = windowManager.fromWebContents(event.sender);
    if (!win) {
      throw new Error("window not found");
    }
    const context = findWindowContext(win);
    if (!context) {
      throw new Error("window context not found");
    }
    return context;
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
