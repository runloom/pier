import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { samplePierResource } from "../services/pier-resource/sample.ts";
import { foregroundActivityService } from "./foreground-activity.ts";

/**
 * 资源快照 IPC。
 * 采样为异步 `ps`（主路径不 `execFileSync` 堵 event loop）；
 * 多窗并发由 sample 层单飞合并。
 */
export function registerPierResourceIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    PIER.PIER_RESOURCE_SNAPSHOT,
    async (): Promise<PierResourceSnapshot> =>
      samplePierResource({
        activities: foregroundActivityService.snapshot().activities,
      })
  );
}
