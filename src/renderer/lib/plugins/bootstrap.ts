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
        `${entry.manifest.id}:${entry.runtime.kind}:${entry.runtime.rendererEntryUrl ?? ""}`
    )
    .join("\n");
}

/**
 * 启动引导: renderer 插件 runtime 由 plugin-registry 镜像 store 驱动 —
 * store 变化(初始拉取 / PLUGINS_CHANGED 广播 / 手动 refresh)且运行态
 * 集合有实质变化时刷新 runtime。返回解绑 + dispose 的清理函数。
 *
 * 注: Zustand set() 同步通知订阅者, 所以 await 返回时初始拉取对应的
 * runtime.refresh(含插件 panel 注册)已完成, main.tsx 在 App render 前
 * await 本函数的时序约束不变。
 */
export async function bootstrapBuiltinPlugins(): Promise<() => void> {
  const unsubscribeStore = usePluginRegistryStore.subscribe((state, prev) => {
    if (
      activeBuiltinPluginKey(state.plugins) !==
      activeBuiltinPluginKey(prev.plugins)
    ) {
      rendererPluginRuntime.refresh(state.plugins);
    }
  });
  const unsubscribeBroadcast = await initPluginRegistry();
  return () => {
    unsubscribeBroadcast();
    unsubscribeStore();
    rendererPluginRuntime.dispose();
  };
}
