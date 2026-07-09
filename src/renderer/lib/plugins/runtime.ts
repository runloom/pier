import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { PluginRpcEventPayload } from "@shared/contracts/plugin-rpc.ts";
import { closeOverlaysForPlugin } from "../../stores/plugin-overlay.store.ts";
import { BUILTIN_RENDERER_PLUGIN_MODULES } from "./builtin-catalog.ts";
import {
  createExternalRendererPluginContext,
  type RendererPluginRpcBridge,
} from "./external-plugin-context.ts";
import { loadExternalRendererPlugin } from "./external-renderer-loader.ts";
import { createRendererPluginContext } from "./host-context.ts";
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";
import { installPluginSharedRuntime } from "./plugin-shared-runtime.ts";

function indexModules(
  modules: readonly RendererPluginModule[]
): ReadonlyMap<string, RendererPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

/**
 * Builds a global renderer RPC bridge backed by `window.pier.pluginRpc`.
 * Broadcast events fan out to all subscribers; each subscriber filters
 * by pluginId + event (design §7.3).
 */
function createRendererPluginRpcBridge(): RendererPluginRpcBridge {
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
      for (const cb of set) {
        try {
          cb(payload.payload);
        } catch (err) {
          console.error(`[plugin-rpc] subscriber threw for ${key}:`, err);
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
        set!.delete(callback);
        if (set!.size === 0) subscribers.delete(key);
      };
    },
  };
}

export class RendererPluginRuntime {
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, RendererPluginModule>;
  private readonly rpcBridge: RendererPluginRpcBridge;
  private sharedRuntimeInstalled = false;
  private latestEntries: readonly PluginRegistryEntry[] = [];

  constructor(
    modules: readonly RendererPluginModule[] = BUILTIN_RENDERER_PLUGIN_MODULES
  ) {
    this.modules = indexModules(modules);
    this.rpcBridge = createRendererPluginRpcBridge();
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) {
      try {
        dispose();
      } catch (err) {
        console.error("[renderer-plugin-runtime] dispose failed:", err);
      }
    }
    this.disposers.clear();
  }

  refresh(entries: readonly PluginRegistryEntry[]): void {
    this.latestEntries = entries;
    this.dispose();
    for (const entry of entries) {
      if (!entry.runtime.enabled) continue;
      if (entry.runtime.kind === "builtin") {
        this.activateBuiltin(entry);
      } else if (entry.runtime.kind === "external") {
        // External plugin activation is async; fire-and-forget.
        this.activateExternal(entry).catch((err: unknown) => {
          console.error(
            `[renderer-plugin-runtime] external ${entry.manifest.id} activate failed:`,
            err
          );
        });
      }
    }
  }

  private activateBuiltin(entry: PluginRegistryEntry): void {
    const module = this.modules.get(entry.manifest.id);
    if (!module) return;
    const context = createRendererPluginContext(entry);
    const dispose = module.activate(context);
    this.disposers.set(entry.manifest.id, () => {
      try {
        dispose();
      } finally {
        clearHostGroupContentForPlugin(entry.manifest.id);
        closeOverlaysForPlugin(entry.manifest.id);
      }
    });
  }

  private async activateExternal(entry: PluginRegistryEntry): Promise<void> {
    if (!entry.runtime.rendererEntryUrl) return;
    if (!this.sharedRuntimeInstalled) {
      installPluginSharedRuntime();
      this.sharedRuntimeInstalled = true;
    }
    const context = createExternalRendererPluginContext(
      entry,
      this.rpcBridge,
      () => this.latestEntries
    );
    const result = await loadExternalRendererPlugin({
      context,
      rendererEntryUrl: entry.runtime.rendererEntryUrl,
      expectedPluginId: entry.manifest.id,
    });
    if (!result.ok) {
      console.error(
        `[renderer-plugin-runtime] external ${entry.manifest.id} failed: ${result.error}`
      );
      return;
    }
    this.disposers.set(entry.manifest.id, () => {
      try {
        result.disposer();
      } catch (err) {
        console.error(
          `[renderer-plugin-runtime] external ${entry.manifest.id} dispose:`,
          err
        );
      }
      closeOverlaysForPlugin(entry.manifest.id);
    });
  }
}

export const rendererPluginRuntime = new RendererPluginRuntime();
