import {
  canonicalizePluginDataParams,
  canvasHostPermissionError,
  canvasHostUnsupportedError,
  type PluginDataProjectionParams,
  pluginDataProjectionLeaseId,
  resolvePluginDataProjectionIdentity,
} from "@shared/contracts/canvas-host.ts";
import type {
  PluginRpcInvokeRequest,
  PluginRpcInvokeResult,
} from "@shared/contracts/plugin/rpc.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { PluginRpcBus } from "../../plugins/rpc-bus.ts";
import type { PluginService } from "../plugin-service.ts";

const PROJECTION_METHOD_PREFIX = "projection.";

export interface PluginDataProjectionService {
  /** Manifest-declared RPC method; no `projection.` prefix. */
  invokeAction(
    pluginId: string,
    key: string,
    payload: unknown
  ): Promise<unknown>;
  /** 主进程命令处理体：声明检查走基键，RPC 载荷带规范化 params。 */
  snapshot(
    pluginId: string,
    key: string,
    params?: PluginDataProjectionParams
  ): Promise<unknown>;
  /** 插件 rpc 事件过滤转发：仅转发已声明基键，信封带 scope。返回 dispose。 */
  tapEvents(): () => void;
  watchStart(
    pluginId: string,
    key: string,
    params?: PluginDataProjectionParams
  ): Promise<void>;
  watchStop(
    pluginId: string,
    key: string,
    params?: PluginDataProjectionParams
  ): Promise<void>;
}

function throwMappedBusError(
  result: Extract<PluginRpcInvokeResult, { ok: false }>
): never {
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

function projectionRpcPayload(
  params?: PluginDataProjectionParams
): { params: PluginDataProjectionParams } | null {
  return params ? { params } : null;
}

export function createPluginDataProjectionService(deps: {
  bus: PluginRpcBus;
  broadcastToWindows: (channel: string, payload: unknown) => void;
  manifestActions: (pluginId: string) => readonly string[];
  manifestProjections: (pluginId: string) => readonly string[];
}): PluginDataProjectionService {
  const declaredProjection = (pluginId: string, key: string): boolean =>
    deps.manifestProjections(pluginId).includes(key);
  const declaredAction = (pluginId: string, key: string): boolean =>
    deps.manifestActions(pluginId).includes(key);
  const watchCounts = new Map<string, number>();
  const watchTails = new Map<string, Promise<void>>();

  const invokeMapped = async (
    request: PluginRpcInvokeRequest
  ): Promise<unknown> => {
    const result = await deps.bus.invoke(request);
    if (!result.ok) {
      throwMappedBusError(result);
    }
    return result.data;
  };

  const invokeOptionalWatch = async (
    pluginId: string,
    key: string,
    op: "unwatch" | "watch",
    params?: PluginDataProjectionParams
  ): Promise<void> => {
    const result = await deps.bus.invoke({
      method: `${PROJECTION_METHOD_PREFIX}${key}.${op}`,
      payload: projectionRpcPayload(params),
      pluginId,
    });
    if (result.ok || result.error.code === "not_found") {
      return;
    }
    throwMappedBusError(result);
  };

  const enqueueWatch = (
    id: string,
    work: () => Promise<void>
  ): Promise<void> => {
    const previous = watchTails.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);
    watchTails.set(id, next);
    return next.finally(() => {
      if (watchTails.get(id) === next) {
        watchTails.delete(id);
      }
    });
  };

  return {
    async invokeAction(pluginId, key, payload) {
      if (!declaredAction(pluginId, key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare canvas action "${key}"`
        );
      }
      return await invokeMapped({
        method: key,
        payload: payload ?? null,
        pluginId,
      });
    },
    async snapshot(pluginId, key, params) {
      const identity = resolvePluginDataProjectionIdentity(key, params);
      if (!declaredProjection(pluginId, identity.key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare data projection "${identity.key}"`
        );
      }
      return await invokeMapped({
        method: `${PROJECTION_METHOD_PREFIX}${identity.key}`,
        payload: projectionRpcPayload(identity.params),
        pluginId,
      });
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
        const { params: rawParams, pluginId, ...payload } = data;
        if (!declaredProjection(pluginId, key)) {
          return;
        }
        const params = canonicalizePluginDataParams(rawParams);
        deps.broadcastToWindows(PIER_BROADCAST.PLUGIN_DATA_CHANGED, {
          ...payload,
          key,
          pluginId,
          ...(params ? { params } : {}),
        });
      });
    },
    async watchStart(pluginId, key, params) {
      const identity = resolvePluginDataProjectionIdentity(key, params);
      if (!declaredProjection(pluginId, identity.key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare data projection "${identity.key}"`
        );
      }
      const id = pluginDataProjectionLeaseId(
        pluginId,
        identity.key,
        identity.params
      );
      await enqueueWatch(id, async () => {
        const previous = watchCounts.get(id) ?? 0;
        if (previous === 0) {
          await invokeOptionalWatch(
            pluginId,
            identity.key,
            "watch",
            identity.params
          );
        }
        watchCounts.set(id, previous + 1);
      });
    },
    async watchStop(pluginId, key, params) {
      const identity = resolvePluginDataProjectionIdentity(key, params);
      if (!declaredProjection(pluginId, identity.key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare data projection "${identity.key}"`
        );
      }
      const id = pluginDataProjectionLeaseId(
        pluginId,
        identity.key,
        identity.params
      );
      await enqueueWatch(id, async () => {
        const previous = watchCounts.get(id) ?? 0;
        if (previous <= 0) {
          return;
        }
        const next = previous - 1;
        if (next === 0) {
          watchCounts.delete(id);
          await invokeOptionalWatch(
            pluginId,
            identity.key,
            "unwatch",
            identity.params
          );
          return;
        }
        watchCounts.set(id, next);
      });
    },
  };
}

export interface ManifestProjectionReader {
  read(pluginId: string): readonly string[];
  readActions(pluginId: string): readonly string[];
  refresh(): Promise<void>;
}

/**
 * manifest.dataProjections / canvasActions 的进程内同步索引。PluginService
 * 只有异步 list()/inspect()，命令分发需要同步声明检查，故由注册表变更回调驱动刷新。
 */
export function createManifestProjectionReader(
  plugins: PluginService
): ManifestProjectionReader {
  const empty: readonly string[] = [];
  let projections = new Map<string, readonly string[]>();
  let actions = new Map<string, readonly string[]>();
  return {
    read: (pluginId) => projections.get(pluginId) ?? empty,
    readActions: (pluginId) => actions.get(pluginId) ?? empty,
    async refresh() {
      const result = await plugins.list();
      const nextProjections = new Map<string, readonly string[]>();
      const nextActions = new Map<string, readonly string[]>();
      for (const entry of result.entries) {
        nextProjections.set(entry.manifest.id, entry.manifest.dataProjections);
        nextActions.set(
          entry.manifest.id,
          entry.manifest.canvasActions ?? empty
        );
      }
      projections = nextProjections;
      actions = nextActions;
    },
  };
}
