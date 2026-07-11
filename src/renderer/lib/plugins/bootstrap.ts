import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  initPluginRegistry,
  usePluginRegistryStore,
} from "@/stores/plugin-registry.store.ts";
import { rendererPluginRuntime } from "./runtime.ts";

/**
 * runtime 关心「哪些插件（builtin + external）处于运行态」。广播快照的
 * 数组每次都是新引用，用该 key 判等去重，避免 registry 无实质变化时对
 * 全部插件做 dispose+reactivate。
 */
export function activeBuiltinPluginKey(
  entries: readonly PluginRegistryEntry[]
): string {
  return entries
    .filter(
      (entry) =>
        entry.runtime.enabled &&
        (entry.runtime.kind === "builtin" || entry.runtime.kind === "external")
    )
    .map(
      (entry) =>
        `${entry.manifest.id}:${entry.manifest.version}:${entry.runtime.kind}:${entry.runtime.rendererEntryUrl ?? ""}:${entry.runtime.sourceRevision ?? ""}`
    )
    .join("\n");
}

export interface RendererPluginBootstrapHandle {
  dispose(): Promise<void>;
  startExternal(): void;
}

/**
 * 启动引导: renderer 插件 runtime 由 plugin-registry 镜像 store 驱动 —
 * store 变化(初始拉取 / PLUGINS_CHANGED 广播 / 手动 refresh)且运行态
 * 集合有实质变化时刷新 runtime。返回解绑 + dispose 的清理函数。
 *
 * 首屏只等待 builtin 贡献注册完成，保证布局恢复时 panel component 已存在。
 * external 插件在首屏渲染后各自独立加载，不进入 builtin 生命周期串行队列；
 * 单个外部包超时或失败只产生该插件的诊断。
 */
export async function bootstrapBuiltinPlugins(): Promise<RendererPluginBootstrapHandle> {
  let bootstrapping = true;
  let externalStarted = false;
  let pendingEntries: readonly PluginRegistryEntry[] | null = null;
  const refresh = (entries: readonly PluginRegistryEntry[]): void => {
    const operation = rendererPluginRuntime.refresh(entries, {
      startExternal: externalStarted,
    });
    operation.catch((error: unknown) => {
      console.error("[renderer-plugin-bootstrap] refresh failed:", error);
    });
  };
  const unsubscribeStore = usePluginRegistryStore.subscribe((state, prev) => {
    if (
      activeBuiltinPluginKey(state.plugins) !==
      activeBuiltinPluginKey(prev.plugins)
    ) {
      if (bootstrapping) {
        pendingEntries = state.plugins;
      } else {
        refresh(state.plugins);
      }
    }
  });
  let unsubscribeBroadcast: () => void = () => undefined;
  try {
    unsubscribeBroadcast = await initPluginRegistry();
    const initialEntries =
      pendingEntries ?? usePluginRegistryStore.getState().plugins;
    await rendererPluginRuntime.refresh(initialEntries, {
      startExternal: false,
    });
    bootstrapping = false;
    const latestEntries =
      pendingEntries ?? usePluginRegistryStore.getState().plugins;
    if (
      activeBuiltinPluginKey(latestEntries) !==
      activeBuiltinPluginKey(initialEntries)
    ) {
      await rendererPluginRuntime.refresh(latestEntries, {
        startExternal: false,
      });
    }
  } catch (error) {
    unsubscribeBroadcast();
    unsubscribeStore();
    await rendererPluginRuntime.dispose().catch((disposeError: unknown) => {
      console.error(
        "[renderer-plugin-bootstrap] failed bootstrap cleanup:",
        disposeError
      );
    });
    throw error;
  }
  return {
    async dispose() {
      unsubscribeBroadcast();
      unsubscribeStore();
      await rendererPluginRuntime.dispose();
    },
    startExternal() {
      if (externalStarted) {
        return;
      }
      externalStarted = true;
      rendererPluginRuntime.startExternalActivations();
    },
  };
}
