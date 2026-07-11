import type {
  PluginRegistryDiagnostic,
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import { create } from "zustand";

/**
 * 插件 registry 的 renderer 镜像 store.
 *
 * main 是唯一数据源: bootstrap 时经 initPluginRegistry() 全量拉取一次,
 * 之后由 PIER_BROADCAST.PLUGINS_CHANGED 广播保持同步(含多窗口一致性).
 *
 * `plugins` / `initialized` / `refresh` 是 Phase 2(状态栏用户控制)与
 * Phase 3(configuration 贡献点)的硬依赖, 不可改名.
 */
interface PluginRegistryStoreState {
  diagnostics: PluginRegistryDiagnostic[];
  /** 最近一次全量拉取失败的错误消息; 快照应用成功后清空. */
  error: string | null;
  /** 首次全量拉取(成功或失败)完成后为 true — UI 以此区分 loading 态. */
  initialized: boolean;
  plugins: PluginRegistryEntry[];
  refresh: () => Promise<void>;
}

let broadcastGeneration = 0;
let latestRefreshId = 0;

function snapshotPatch(result: PluginRegistryListResult) {
  return {
    diagnostics: result.diagnostics,
    error: null,
    initialized: true,
    plugins: result.entries,
  };
}

export const usePluginRegistryStore = create<PluginRegistryStoreState>(
  (set) => ({
    diagnostics: [],
    error: null,
    initialized: false,
    plugins: [],

    async refresh() {
      const expectedBroadcastGeneration = broadcastGeneration;
      const refreshId = ++latestRefreshId;
      try {
        const result = await window.pier.plugins.list();
        if (
          refreshId === latestRefreshId &&
          expectedBroadcastGeneration === broadcastGeneration
        ) {
          set(snapshotPatch(result));
        }
      } catch (err) {
        if (
          refreshId === latestRefreshId &&
          expectedBroadcastGeneration === broadcastGeneration
        ) {
          set({
            error: err instanceof Error ? err.message : String(err),
            initialized: true,
          });
        }
      }
    },
  })
);

/**
 * bootstrap 时每窗口调用一次: 先订阅广播(避免拉取窗口期丢事件), 再全量拉取.
 * 返回广播解绑函数.
 */
export async function initPluginRegistry(): Promise<() => void> {
  const unsubscribe = window.pier.plugins.onChanged((snapshot) => {
    broadcastGeneration += 1;
    usePluginRegistryStore.setState(snapshotPatch(snapshot));
  });
  await usePluginRegistryStore.getState().refresh();
  return unsubscribe;
}
