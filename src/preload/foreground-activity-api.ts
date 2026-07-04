import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Renderer 侧访问统一前台活动的 API。写入方是 main 端
 * ForegroundActivityAggregator 的广播；读取方走 snapshot() 初次拉取 +
 * onChanged() 增量订阅。
 */
export interface PierForegroundActivityAPI {
  onChanged: (cb: (b: ForegroundActivityBroadcast) => void) => () => void;
  snapshot: () => Promise<ForegroundActivityBroadcast>;
}

export const foregroundActivityApi: PierForegroundActivityAPI = {
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: ForegroundActivityBroadcast
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED, listener);
    };
  },
  snapshot: () => ipcRenderer.invoke("pier:foreground-activity:snapshot"),
};
