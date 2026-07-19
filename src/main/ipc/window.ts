/**
 * Window IPC handlers — renderer 通过 pier://window:* 调用.
 *
 * 保留 context 和 closeCurrent:
 * - context: 需要 sender window 从 windowManager 查询，无对应 PierCommand
 * - closeCurrent: 用 sender window，renderer 无需传 windowId，无对应 PierCommand
 * 已迁至 command router: close/create/focus/list
 */

import { parseRendererRuntimeFailureReport } from "@shared/contracts/renderer-runtime-failure.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { findWindowContext } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";

const rendererRuntimeLog = createLogger("renderer-runtime");

export function registerWindowIpc(ipcMain: IpcMain): void {
  ipcMain.on(PIER.WINDOW_RENDERER_RUNTIME_FAILURE, (event, rawFailure) => {
    const win = windowManager.fromWebContents(event.sender);
    if (!win) {
      rendererRuntimeLog.warn(
        "Dropped renderer runtime failure: unknown window",
        {
          senderId: event.sender.id,
        }
      );
      return;
    }
    const failure = parseRendererRuntimeFailureReport(rawFailure);
    if (!failure) {
      rendererRuntimeLog.warn(
        "Dropped renderer runtime failure: invalid payload",
        {
          senderId: event.sender.id,
        }
      );
      return;
    }
    const context = findWindowContext(win);
    rendererRuntimeLog.error("React root failed", {
      ...failure,
      ...(context
        ? { recordId: context.recordId, windowId: context.windowId }
        : {}),
    });
  });

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

  // 错误恢复 / 软重启：直接 reload 发起方 WebContents，不走 app.relaunch。
  // BaseWindow + WebContentsView 下 location.reload() 不可靠；也不能在
  // windowManager 查不到时静默成功，否则错误页 Reload 会“点了没反应”。
  ipcMain.handle(PIER.WINDOW_RELOAD, (event) => {
    const contents = event.sender;
    if (contents.isDestroyed()) {
      throw new Error("window webContents destroyed");
    }
    contents.reload();
  });
}
