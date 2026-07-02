import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";

export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  gitRendererPlugin,
  filesRendererPlugin,
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
