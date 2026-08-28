import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Pier 资源快照 API。拉取式：画布 `useSystemResources` 挂载时 2s 轮询；
 * 无人拉取时 main 侧零开销。
 */
export interface PierResourceAPI {
  snapshot: () => Promise<PierResourceSnapshot>;
}

export const pierResourceApi: PierResourceAPI = {
  snapshot: () => ipcRenderer.invoke(PIER.PIER_RESOURCE_SNAPSHOT),
};
