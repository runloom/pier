import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

export function createPluginProjectMemoryContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["projectMemory"] {
  return {
    clearStore: (root) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.clearStore(root);
    },
    deleteObservation: (root, entityName, index, observation) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.deleteObservation(
        root,
        entityName,
        index,
        observation
      );
    },
    disable: (root) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.disable(root);
    },
    enable: (root) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.enable(root);
    },
    list: (root) => {
      assertPluginCapability(entry, "workspace:read");
      return window.pier.memory.list(root);
    },
    status: (root) => {
      assertPluginCapability(entry, "workspace:read");
      return window.pier.memory.status(root);
    },
  };
}
