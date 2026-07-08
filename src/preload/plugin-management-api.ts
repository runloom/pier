import type {
  ManagedPluginCatalogSnapshot,
  ManagedPluginOperationResult,
} from "@shared/contracts/managed-plugin.ts";
import type { PluginRpcEventPayload } from "@shared/contracts/plugin-rpc.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokePierCommand } from "./ipc-envelope.ts";

/**
 * Preload facade for `window.pier.managedPlugins`. Each method routes through
 * the shared PIER.COMMAND_EXECUTE channel — the command router dispatches to
 * the managed plugin install service.
 */

export interface ManagedPluginsPreloadApi {
  checkUpdates(): Promise<ManagedPluginCatalogSnapshot>;
  clearDevOverride(id: string): Promise<ManagedPluginOperationResult>;
  disable(id: string): Promise<ManagedPluginOperationResult>;
  enable(id: string): Promise<ManagedPluginOperationResult>;
  install(id: string): Promise<ManagedPluginOperationResult>;
  list(): Promise<ManagedPluginCatalogSnapshot>;
  rollback(id: string, version: string): Promise<ManagedPluginOperationResult>;
  setDevOverride(
    id: string,
    path: string
  ): Promise<ManagedPluginOperationResult>;
  uninstall(id: string): Promise<ManagedPluginOperationResult>;
  update(id: string): Promise<ManagedPluginOperationResult>;
}

export interface PluginRpcPreloadApi {
  invoke(pluginId: string, method: string, payload: unknown): Promise<unknown>;
  onEvent(cb: (payload: PluginRpcEventPayload) => void): () => void;
}

export interface AppPreloadApi {
  relaunch(): Promise<void>;
}

export function createManagedPluginsPreloadApi(): ManagedPluginsPreloadApi {
  return {
    checkUpdates: () =>
      invokePierCommand<ManagedPluginCatalogSnapshot>({
        type: "plugin.checkUpdates",
      }),
    clearDevOverride: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.devOverride.clear",
      }),
    disable: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.disable",
      }),
    enable: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.enable",
      }),
    install: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.install",
      }),
    list: () =>
      invokePierCommand<ManagedPluginCatalogSnapshot>({
        type: "plugin.catalog.list",
      }),
    rollback: (id, version) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.rollback",
        version,
      }),
    setDevOverride: (id, path) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        path,
        type: "plugin.devOverride.set",
      }),
    uninstall: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.uninstall",
      }),
    update: (id) =>
      invokePierCommand<ManagedPluginOperationResult>({
        id,
        type: "plugin.update",
      }),
  };
}

export function createAppPreloadApi(): AppPreloadApi {
  return {
    relaunch: () => invokePierCommand<void>({ type: "app.relaunch" }),
  };
}

export function createPluginRpcPreloadApi(): PluginRpcPreloadApi {
  return {
    invoke: async (pluginId, method, payload) =>
      await ipcRenderer.invoke(PIER.PLUGIN_RPC_INVOKE, {
        method,
        payload,
        pluginId,
      }),
    onEvent: (cb) => {
      const listener = (
        _event: unknown,
        payload: PluginRpcEventPayload
      ): void => {
        cb(payload);
      };
      ipcRenderer.on(PIER_BROADCAST.PLUGIN_RPC_EVENT, listener);
      return () => {
        ipcRenderer.off(PIER_BROADCAST.PLUGIN_RPC_EVENT, listener);
      };
    },
  };
}
