import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

/**
 * environments namespace 适配器: capability 断言后透传 preload facade。
 * 读方法需要 environment:read；写方法需要 environment:write。
 */
export function createPluginEnvironmentsContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["environments"] {
  return {
    projectSnapshot: (projectRootPath) => {
      assertPluginCapability(entry, "environment:read");
      return window.pier.environments
        .snapshot({ projectRootPath })
        .then((state) => state.projects[0] ?? null);
    },
    snapshot: (request) => {
      assertPluginCapability(entry, "environment:read");
      return window.pier.environments.snapshot(request);
    },
    update: (request) => {
      assertPluginCapability(entry, "environment:write");
      return window.pier.environments.update(request);
    },
    worktreeBinding: (request) => {
      assertPluginCapability(entry, "environment:read");
      return window.pier.environments.worktreeBinding(request);
    },
  };
}
