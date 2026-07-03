import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { listProjects, onProjectChange } from "../state/project-store.ts";
import { listAppWindowIds } from "../windows/window-identity.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";

/**
 * Project registry renderer 面的入口。
 *
 * 契约：
 * - `pier://project:list` → `Project[]`（全量快照，renderer store hydrate 用）
 * - `pier://project:changed` → `Project[]` 广播（store mutate 后触发）
 *
 * renderer 只读消费；实际写入由 panel-context-resolver 触发 upsert。
 */
export function registerProjectIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.PROJECT_LIST, async () => await listProjects());
  onProjectChange((projects) => {
    for (const windowId of listAppWindowIds()) {
      forwardToWindow(
        Number(windowId),
        PIER_BROADCAST.PROJECT_CHANGED,
        projects,
        "pier-project-broadcast"
      );
    }
  });
}
