import type { PluginRpcEventPayload } from "@shared/contracts/plugin-rpc.ts";
import type { RendererPluginRpcBridge } from "./external-plugin-context.ts";

/** 以 preload 的 pluginId 作用域 RPC 建立 renderer 订阅桥。 */
export function createRendererPluginRpcBridge(): RendererPluginRpcBridge {
  interface WindowPluginRpc {
    invoke(
      pluginId: string,
      method: string,
      payload: unknown
    ): Promise<unknown>;
    onEvent(cb: (payload: PluginRpcEventPayload) => void): () => void;
  }
  const pier = (window as unknown as { pier?: { pluginRpc?: WindowPluginRpc } })
    .pier;
  const pluginRpc = pier?.pluginRpc;
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  if (pluginRpc) {
    pluginRpc.onEvent((payload) => {
      const key = `${payload.pluginId}:${payload.event}`;
      const set = subscribers.get(key);
      if (!set) return;
      for (const callback of set) {
        try {
          callback(payload.payload);
        } catch (error) {
          console.error(`[plugin-rpc] subscriber threw for ${key}:`, error);
        }
      }
    });
  }
  return {
    invoke: (pluginId, method, payload) => {
      if (!pluginRpc) {
        return Promise.reject(new Error("pluginRpc preload not available"));
      }
      return pluginRpc.invoke(pluginId, method, payload);
    },
    subscribe: (pluginId, event, callback) => {
      const key = `${pluginId}:${event}`;
      let set = subscribers.get(key);
      if (!set) {
        set = new Set();
        subscribers.set(key, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
        if (set?.size === 0) subscribers.delete(key);
      };
    },
  };
}
