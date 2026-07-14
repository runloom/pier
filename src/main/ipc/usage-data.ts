import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { broadcastUsageDataChanged } from "../app-core/window-broadcasts.ts";
import type { UsageDataService } from "../services/usage-data/usage-data-service.ts";

const log = createLogger("usage-data.ipc");

/**
 * Wire cross-plugin cost aggregation to renderer:
 * - `USAGE_DATA_SNAPSHOT`   — 拉取当前完整聚合（renderer store 挂载初值）。
 * - `USAGE_DATA_REFRESH_ALL` — 触发全部注册源 rescan + 广播。
 * - `USAGE_DATA_CHANGED`   — publish/refresh 后主动推给所有窗口。
 *
 * 广播为窗口级 fan-out：每个 renderer 独立镜像同一份聚合快照，无窗口私有过滤。
 */
export function registerUsageDataIpc(
  ipcMain: IpcMain,
  usageData: UsageDataService
): void {
  ipcMain.handle(PIER.USAGE_DATA_SNAPSHOT, () => usageData.aggregate());
  ipcMain.handle(PIER.USAGE_DATA_REFRESH_ALL, async () => {
    try {
      await usageData.refreshAll();
    } catch (err) {
      log.error("refreshAll failed", { err });
      throw err;
    }
  });
  usageData.subscribe(broadcastUsageDataChanged);
}
