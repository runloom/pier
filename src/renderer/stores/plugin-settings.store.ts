/**
 * 插件配置项的 renderer 镜像 store。
 *
 * main 是唯一数据源：initPluginSettingsStore 先订阅 PLUGIN_SETTINGS_CHANGED
 * 广播再全量拉取（避免窗口初始化窗口期丢事件）；写路径（set/reset）在 IPC
 * resolve 后用返回的全量快照同步 applySnapshot（发起窗口即时一致，main 内存
 * 态已提交），广播兜底其它窗口 —— 广播与 resolve 双投递按 diff 去重。
 */
import type {
  JsonValue,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import { diffConfigurationValues } from "@shared/plugin-settings.ts";
import { create } from "zustand";

type PluginSettingsChangeListener = (changedKeys: readonly string[]) => void;

const changeListeners = new Set<PluginSettingsChangeListener>();

/** 插件 context 的 onDidChange 底座 — 与 zustand 订阅解耦，携带 changedKeys。 */
export function subscribePluginSettingsChanges(
  listener: PluginSettingsChangeListener
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

interface PluginSettingsStoreState {
  applySnapshot: (snapshot: PluginSettingsState) => void;
  /** 最近一次 IPC 操作失败的错误消息；操作成功后清空。 */
  error: string | null;
  initialized: boolean;
  reset: (key: string) => Promise<void>;
  set: (key: string, value: JsonValue) => Promise<void>;
  values: Record<string, JsonValue>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const usePluginSettingsStore = create<PluginSettingsStoreState>(
  (set, get) => ({
    applySnapshot: (snapshot) => {
      const changedKeys = diffConfigurationValues(
        get().values,
        snapshot.values
      );
      // resolve 路径与广播路径双投递：无 diff 即去重跳过（首次 init 除外）。
      if (get().initialized && changedKeys.length === 0) {
        return;
      }
      set({ initialized: true, values: snapshot.values });
      for (const listener of changeListeners) {
        listener(changedKeys);
      }
    },
    error: null,
    initialized: false,
    reset: async (key) => {
      try {
        const snapshot = await window.pier.pluginSettings.reset(key);
        get().applySnapshot(snapshot);
        set({ error: null });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },
    set: async (key, value) => {
      // set() resolve 语义：main 内存已提交，发起窗口在 resolve 路径同步镜像。
      try {
        const snapshot = await window.pier.pluginSettings.set(key, value);
        get().applySnapshot(snapshot);
        set({ error: null });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },
    values: {},
  })
);

/** bootstrap：先订阅广播再全量拉取，避免窗口初始化窗口期丢事件。返回解绑函数。 */
export async function initPluginSettingsStore(): Promise<() => void> {
  const dispose = window.pier.pluginSettings.onChanged((payload) => {
    usePluginSettingsStore
      .getState()
      .applySnapshot({ values: payload.values, version: 1 });
  });
  try {
    const snapshot = await window.pier.pluginSettings.getAll();
    usePluginSettingsStore.getState().applySnapshot(snapshot);
    usePluginSettingsStore.setState({ error: null });
  } catch (err) {
    usePluginSettingsStore.setState({
      error: errorMessage(err),
      initialized: true,
    });
  }
  return dispose;
}
