import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  JsonValue,
  PluginSettingsChangedPayload,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierPluginSettingsAPI {
  getAll: () => Promise<PluginSettingsState>;
  /** 订阅设置变更广播 — main 会广播给所有窗口（含发起窗口，镜像 store 按 diff 去重）。 */
  onChanged: (
    cb: (payload: PluginSettingsChangedPayload) => void
  ) => () => void;
  reset: (key: string) => Promise<PluginSettingsState>;
  /** resolve 时 main 内存已提交；返回全量新快照供发起窗口同步镜像。 */
  set: (key: string, value: JsonValue) => Promise<PluginSettingsState>;
}

// 与 index.ts / git-api.ts 同款 envelope 解包(独立文件避免 index.ts 触 500 行上限)。
async function invokePierCommand<T>(command: PierCommand): Promise<T> {
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

export const pluginSettingsApi: PierPluginSettingsAPI = {
  getAll: () =>
    invokePierCommand<PluginSettingsState>({ type: "pluginSettings.getAll" }),
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: PluginSettingsChangedPayload
    ) => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED, listener);
    };
  },
  reset: (key) =>
    invokePierCommand<PluginSettingsState>({
      key,
      type: "pluginSettings.reset",
    }),
  set: (key, value) =>
    invokePierCommand<PluginSettingsState>({
      key,
      type: "pluginSettings.set",
      value,
    }),
};
