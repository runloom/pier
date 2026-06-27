import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { worktreeRendererPlugin } from "@plugins/builtin/worktree/renderer/index.ts";

export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  worktreeRendererPlugin,
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
