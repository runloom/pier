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
