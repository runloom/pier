import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { samplePierResource } from "../services/pier-resource/sample-pier-resource.ts";
import { foregroundActivityService } from "./foreground-activity.ts";

/**
 * 资源快照 IPC。
 * 采样含同步 `ps`，先 `setImmediate` 让出一轮 event loop，避免在
 * `ipcMain.handle` 调用栈上直接堵死菜单/焦点/其它 invoke。
 */
export function registerPierResourceIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    PIER.PIER_RESOURCE_SNAPSHOT,
    (): Promise<PierResourceSnapshot> =>
      new Promise((resolve, reject) => {
        setImmediate(() => {
          try {
            resolve(
              samplePierResource({
                activities: foregroundActivityService.snapshot().activities,
              })
            );
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      })
  );
}
