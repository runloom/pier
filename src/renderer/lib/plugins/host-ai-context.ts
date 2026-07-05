import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

export function createPluginAiContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["ai"] {
  return {
    generateText: (request) => {
      assertPluginCapability(entry, "ai:invoke");
      return window.pier.ai.generateText(request);
    },
    status: () => {
      assertPluginCapability(entry, "ai:invoke");
      return window.pier.ai.status();
    },
  };
}
