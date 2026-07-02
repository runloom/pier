import type {
  JsonValue,
  PluginSettingsChangedPayload,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokePierCommand } from "./ipc-envelope.ts";

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
