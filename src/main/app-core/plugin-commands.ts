import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

function operationCommitted(result: unknown): boolean {
  return !(
    result &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok !== true
  );
}

function rendererRuntimeIdentity(entry: PluginRegistryEntry | null): string {
  if (!entry) {
    return "missing";
  }
  return JSON.stringify([
    entry.runtime.enabled,
    entry.runtime.kind,
    entry.runtime.rendererEntryUrl ?? null,
    entry.runtime.sourceRevision ?? null,
    entry.manifest.version,
  ]);
}

async function runPluginRuntimeTransition<T>(input: {
  commit: () => Promise<T>;
  pluginId: string;
  reason: "plugin-disable" | "plugin-reload";
  services: PierCoreServices;
}): Promise<T> {
  const { commit, pluginId, reason, services } = input;
  const canInspect = typeof services.plugins.inspect === "function";
  let runtimeChanged = true;
  return await services.pluginDisableTransitions.runDisable<T>({
    commit: async () => {
      let before: PluginRegistryEntry | null = null;
      let inspectionReliable = canInspect;
      if (canInspect) {
        try {
          before = await services.plugins.inspect(pluginId);
        } catch {
          inspectionReliable = false;
        }
      }
      const result = await commit();
      if (canInspect) {
        let after: PluginRegistryEntry | null = null;
        try {
          after = await services.plugins.inspect(pluginId);
        } catch {
          inspectionReliable = false;
        }
        runtimeChanged =
          !inspectionReliable ||
          rendererRuntimeIdentity(before) !== rendererRuntimeIdentity(after);
      }
      return result;
    },
    finalizeWindow: async ({ generation, outcome, transitionId, windowId }) => {
      const result = await services.rendererCommand.execute(
        reason === "plugin-disable"
          ? {
              generation,
              outcome,
              pluginId,
              transitionId,
              type: "plugin.finalizeDisable",
              windowId,
            }
          : {
              generation,
              outcome,
              pluginId,
              transitionId,
              type: "plugin.finalizeReload",
              windowId,
            }
      );
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    isCommitted: (result) => operationCommitted(result) && runtimeChanged,
    listWindowIds: () => services.window.list().map((window) => window.id),
    pluginId,
    prepareWindow: async ({ generation, transitionId, windowId }) => {
      const result = await services.rendererCommand.execute(
        reason === "plugin-disable"
          ? {
              generation,
              pluginId,
              transitionId,
              type: "plugin.prepareDisable",
              windowId,
            }
          : {
              generation,
              pluginId,
              transitionId,
              type: "plugin.prepareReload",
              windowId,
            }
      );
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    reason,
  });
}

export async function executePluginCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "plugin.list":
      return success(requestId, await services.plugins.list());
    case "plugin.disable": {
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: async () => {
            if (services.managedPlugins?.getIndex?.().plugins[command.id]) {
              return await services.managedPlugins.disable(command.id);
            }
            return await services.plugins.setEnabled(command.id, false);
          },
          pluginId: command.id,
          reason: "plugin-disable",
          services,
        })
      );
    }
    case "plugin.enable": {
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: async () => {
            if (services.managedPlugins?.getIndex?.().plugins[command.id]) {
              return await services.managedPlugins.enable(command.id);
            }
            return await services.plugins.setEnabled(command.id, true);
          },
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    }
    case "plugin.inspect": {
      const plugin = await services.plugins.inspect(command.id);
      if (!plugin) {
        return failure(
          requestId,
          "not_found",
          `plugin not found: ${command.id}`
        );
      }
      return success(requestId, plugin);
    }
    case "pluginSettings.getAll":
      return success(requestId, await services.pluginSettings.getAll());
    case "pluginSettings.set":
      return success(
        requestId,
        await services.pluginSettings.set(command.key, command.value)
      );
    case "pluginSettings.reset":
      return success(
        requestId,
        await services.pluginSettings.reset(command.key)
      );
    case "plugin.catalog.list":
      return success(
        requestId,
        await services.managedPlugins.listCatalogSnapshot()
      );
    case "plugin.checkUpdates":
      return success(requestId, await services.managedPlugins.checkUpdates());
    case "plugin.install":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () => services.managedPlugins.install(command.id),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    case "plugin.update":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () => services.managedPlugins.update(command.id),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    case "plugin.rollback":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () =>
            services.managedPlugins.rollback(command.id, command.version),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    case "plugin.uninstall":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () => services.managedPlugins.uninstall(command.id),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    case "plugin.devOverride.set":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () =>
            services.managedPlugins.setDevOverride(command.id, command.path),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    case "plugin.devOverride.clear":
      return success(
        requestId,
        await runPluginRuntimeTransition({
          commit: () => services.managedPlugins.clearDevOverride(command.id),
          pluginId: command.id,
          reason: "plugin-reload",
          services,
        })
      );
    default:
      return null;
  }
}
