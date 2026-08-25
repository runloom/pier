import type { PluginRpcBus } from "../../plugins/rpc-bus.ts";
import { windowManager } from "../../windows/manager.ts";
import type { PluginService } from "../plugin-service.ts";
import {
  createManifestProjectionReader,
  createPluginDataProjectionService,
  type ManifestProjectionReader,
  type PluginDataProjectionService,
} from "./service.ts";

export interface AppCorePluginDataProjections {
  disposeTap: () => void;
  manifestProjections: ManifestProjectionReader;
  projections: PluginDataProjectionService;
}

/**
 * 插件数据投影装配：canvas 专用快照命令的声明索引 + 已声明键变更事件转发。
 * 启动即拉一次初值（失败仅记日志，命令分发侧按未就绪拒绝，见服务注释）。
 */
export function bootAppCorePluginDataProjections(deps: {
  bus: PluginRpcBus;
  plugins: PluginService;
}): AppCorePluginDataProjections {
  const manifestProjections = createManifestProjectionReader(deps.plugins);
  const broadcastToWindows = (channel: string, payload: unknown): void => {
    for (const win of windowManager.getAll()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  };
  const projections = createPluginDataProjectionService({
    broadcastToWindows,
    bus: deps.bus,
    manifestProjections: manifestProjections.read,
  });
  const disposeTap = projections.tapEvents();
  refreshManifestProjections({ manifestProjections });
  return { disposeTap, manifestProjections, projections };
}

/** 注册表变更回调与启动初值共用：失败仅记日志，命令侧按未就绪拒绝。 */
export function refreshManifestProjections(deps: {
  manifestProjections: ManifestProjectionReader;
}): void {
  deps.manifestProjections.refresh().catch((error) => {
    console.error(
      "[plugin-data-projections] projection index refresh failed",
      error
    );
  });
}
