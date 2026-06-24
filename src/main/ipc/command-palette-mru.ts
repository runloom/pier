/**
 * IPC 桥接.
 * - read: invoke, 返回当前 state (首次会从磁盘读)
 * - record: send (fire-and-forget), service 内部串行写 + 广播
 * - clear: invoke, service 内部重置 + 落盘 + 广播
 */
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";

const CHANNEL_READ = "pier:command-palette-mru:read";
const CHANNEL_RECORD = "pier:command-palette-mru:record";
const CHANNEL_CLEAR = "pier:command-palette-mru:clear";

export function registerCommandPaletteMruIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNEL_READ, async () =>
    appCore.services.commandPaletteMru.read()
  );

  ipcMain.on(CHANNEL_RECORD, (_event, actionId: string) => {
    if (typeof actionId !== "string") {
      return;
    }
    appCore.services.commandPaletteMru.recordUse(actionId).catch((err) => {
      console.error("[command-palette-mru] record 落盘失败, memo 不变:", err);
    });
  });

  ipcMain.handle(CHANNEL_CLEAR, async () => {
    try {
      return await appCore.services.commandPaletteMru.clear();
    } catch (err) {
      console.error("[command-palette-mru] 清空落盘失败:", err);
      throw err;
    }
  });
}
