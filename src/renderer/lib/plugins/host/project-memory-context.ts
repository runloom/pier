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
    disable: (root) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.disable(root);
    },
    enable: (root, options) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.enable(root, options);
    },
    status: (root) => {
      assertPluginCapability(entry, "managedAssets:write");
      return window.pier.memory.status(root);
    },
  };
}
