import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * 统一解包 preload → main 的 PierCommandResult envelope。
 * ok 时返回 data;否则把 error.code 挂到抛出的 Error 上,
 * 供 renderer 侧按 PierCommandErrorCode 做分支处理。
 *
 * 原先 index.ts / git-api.ts / worktree-api.ts / plugin-settings-api.ts /
 * terminal-status-bar-api.ts 各自手写一份逐字相同的实现,此处收编为单一来源。
 */
export async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

/**
 * IPC 广播订阅助手。renderer 侧只关心 payload，callback 不看 event 元数据；
 * 统一封装避免每个 API 文件重复 `on(channel, (_e, p) => cb(p))` + `off` 解绑
 * 样板。返回 disposer.
 */
export function subscribeIpc<P>(
  channel: string,
  cb: (payload: P) => void
): () => void {
  const listener = (_event: unknown, payload: P): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}
