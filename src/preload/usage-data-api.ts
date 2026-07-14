import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * 跨插件成本聚合的 renderer API：初值经 `read()` 拉一次，增量走
 * `PIER_BROADCAST.USAGE_DATA_CHANGED`。`refreshAll()` 触发全部注册源
 * rescan（成本物料手动刷新入口）。
 */
export interface PierUsageDataAPI {
  onChanged: (cb: (snapshot: UsageAggregateSnapshot) => void) => () => void;
  read: () => Promise<UsageAggregateSnapshot>;
  refreshAll: () => Promise<void>;
}

export const usageDataApi: PierUsageDataAPI = {
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: UsageAggregateSnapshot
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.USAGE_DATA_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.USAGE_DATA_CHANGED, listener);
    };
  },
  read: () => ipcRenderer.invoke(PIER.USAGE_DATA_SNAPSHOT),
  refreshAll: () => ipcRenderer.invoke(PIER.USAGE_DATA_REFRESH_ALL),
};
