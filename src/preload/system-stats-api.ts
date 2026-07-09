import type { SystemStatsSnapshot } from "@shared/contracts/system-stats.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * 系统资源快照 API。拉取式：renderer（指挥中心 system-resources 物料）
 * 在面板可见时 2s 轮询；无人拉取时 main 侧零开销。
 */
export interface PierSystemStatsAPI {
  snapshot: () => Promise<SystemStatsSnapshot>;
}

export const systemStatsApi: PierSystemStatsAPI = {
  snapshot: () => ipcRenderer.invoke(PIER.SYSTEM_STATS_SNAPSHOT),
};
