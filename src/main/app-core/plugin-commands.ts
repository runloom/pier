import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executePluginCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "plugin.list":
      return success(requestId, await services.plugins.list());
    case "plugin.disable": {
      if (services.managedPlugins?.getIndex?.().plugins[command.id]) {
        return success(
          requestId,
          await services.managedPlugins.disable(command.id)
        );
      }
      return success(
        requestId,
        await services.plugins.setEnabled(command.id, false)
      );
    }
    case "plugin.enable": {
      if (services.managedPlugins?.getIndex?.().plugins[command.id]) {
        return success(
          requestId,
          await services.managedPlugins.enable(command.id)
        );
      }
      return success(
        requestId,
        await services.plugins.setEnabled(command.id, true)
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
        await services.managedPlugins.install(command.id)
      );
    case "plugin.update":
      return success(
        requestId,
        await services.managedPlugins.update(command.id)
      );
    case "plugin.rollback":
      return success(
        requestId,
        await services.managedPlugins.rollback(command.id, command.version)
      );
    case "plugin.uninstall":
      return success(
        requestId,
        await services.managedPlugins.uninstall(command.id)
      );
    case "plugin.devOverride.set":
      return success(
        requestId,
        await services.managedPlugins.setDevOverride(command.id, command.path)
      );
    case "plugin.devOverride.clear":
      return success(
        requestId,
        await services.managedPlugins.clearDevOverride(command.id)
      );
    default:
      return null;
  }
}
