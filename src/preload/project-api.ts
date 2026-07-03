import type { Project } from "@shared/contracts/project.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Renderer 侧访问 Project registry 的 API。
 * - `list()`: 全量快照（一次性 hydrate 用）
 * - `get(id)`: 按 id 拉单条
 * - `onChanged(cb)`: 订阅 upsert/rename/delete 变更广播
 */
export interface PierProjectAPI {
  get: (id: string) => Promise<Project | null>;
  list: () => Promise<readonly Project[]>;
  onChanged: (cb: (projects: readonly Project[]) => void) => () => void;
}

export const projectApi: PierProjectAPI = {
  get: (id) => ipcRenderer.invoke(PIER.PROJECT_GET, id),
  list: () => ipcRenderer.invoke(PIER.PROJECT_LIST),
  onChanged: (cb) => {
    const listener = (_event: unknown, payload: readonly Project[]): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.PROJECT_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.PROJECT_CHANGED, listener);
    };
  },
};
