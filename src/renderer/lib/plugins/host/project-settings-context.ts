import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { registerPluginProjectSettings } from "../project-settings-registry.ts";
import type { AssertDeclaredContribution } from "./assert-contribution.ts";

export function createPluginProjectSettingsContext(
  entry: PluginRegistryEntry | undefined,
  assertDeclaredContribution: AssertDeclaredContribution
): RendererPluginContext["projectSettings"] {
  return {
    register: (registration) => {
      assertDeclaredContribution(entry, "projectSettings", registration.id);
      return registerPluginProjectSettings(registration);
    },
  };
}
