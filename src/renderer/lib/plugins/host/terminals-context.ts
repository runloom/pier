import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

/**
 * terminals namespace 适配器：打开宿主终端 panel（PierCommand `terminal.open`）。
 * 与单数 `terminal`（读选区 / openUrl，terminal:read）区分：这里是写路径，
 * 统一要求 `terminal:control`；main 侧命令层在带 launch 时按同规则二次校验。
 */
export function createPluginTerminalsContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["terminals"] {
  return {
    open: (request) =>
      Promise.resolve().then(() => {
        assertPluginCapability(entry, "terminal:control");
        return window.pier.terminals.open(request ?? {});
      }),
  };
}
