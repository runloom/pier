import {
  canvasHostPermissionError,
  canvasHostUnsupportedError,
} from "@shared/contracts/canvas-host.ts";
import type { PluginRpcInvokeRequest } from "@shared/contracts/plugin/rpc.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { PluginRpcBus } from "../../plugins/rpc-bus.ts";
import type { PluginService } from "../plugin-service.ts";

const PROJECTION_METHOD_PREFIX = "projection.";

export interface PluginDataProjectionService {
  /** 主进程命令处理体：声明检查 → rpc 代理。声明缺失抛 permission_denied；bus 失败按 code 映射。 */
  snapshot(pluginId: string, key: string): Promise<unknown>;
  /** 插件 rpc 事件过滤转发：仅转发已声明键，payload 原样。返回 dispose。 */
  tapEvents(): () => void;
}

export function createPluginDataProjectionService(deps: {
  bus: PluginRpcBus;
  broadcastToWindows: (channel: string, payload: unknown) => void;
  manifestProjections: (pluginId: string) => readonly string[];
}): PluginDataProjectionService {
  const declared = (pluginId: string, key: string): boolean =>
    deps.manifestProjections(pluginId).includes(key);

  return {
    async snapshot(pluginId, key) {
      if (!declared(pluginId, key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare data projection "${key}"`
        );
      }
      const request: PluginRpcInvokeRequest = {
        method: `${PROJECTION_METHOD_PREFIX}${key}`,
        payload: null,
        pluginId,
      };
      const result = await deps.bus.invoke(request);
      if (!result.ok) {
        // 仅 manifest 声明检查失败才是权限问题；bus 失败按 code 区分：
        // not_found（未注册/已禁用）→ unsupported（宿主侧优雅降级），其余透传为普通错误。
        if (result.error.code === "not_found") {
          throw canvasHostUnsupportedError(result.error.message);
        }
        if (result.error.code !== "permission_denied") {
          throw new Error(result.error.message);
        }
        throw canvasHostPermissionError(result.error.message);
      }
      return result.data;
    },
    tapEvents() {
      // onEvent 为可选旁路：bus 无该钩子时返回 no-op dispose。
      if (!deps.bus.onEvent) {
        return () => {};
      }
      return deps.bus.onEvent((event, data) => {
        if (!event.startsWith(PROJECTION_METHOD_PREFIX)) {
          return;
        }
        const key = event.slice(PROJECTION_METHOD_PREFIX.length);
        const { pluginId, ...payload } = data;
        if (!declared(pluginId, key)) {
          return;
        }
        deps.broadcastToWindows(PIER_BROADCAST.PLUGIN_DATA_CHANGED, {
          ...payload,
          key,
          pluginId,
        });
      });
    },
  };
}

export interface ManifestProjectionReader {
  read(pluginId: string): readonly string[];
  refresh(): Promise<void>;
}

/**
 * manifest.dataProjections 的进程内同步索引。PluginService 只有异步
 * list()/inspect()，命令分发需要同步声明检查，故由注册表变更回调驱动刷新。
 */
export function createManifestProjectionReader(
  plugins: PluginService
): ManifestProjectionReader {
  const empty: readonly string[] = [];
  let index = new Map<string, readonly string[]>();
  return {
    read: (pluginId) => index.get(pluginId) ?? empty,
    async refresh() {
      const result = await plugins.list();
      const next = new Map<string, readonly string[]>();
      for (const entry of result.entries) {
        next.set(entry.manifest.id, entry.manifest.dataProjections);
      }
      index = next;
    },
  };
}
