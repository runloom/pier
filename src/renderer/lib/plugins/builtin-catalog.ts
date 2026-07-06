import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { codexRendererPlugin } from "@plugins/builtin/codex/renderer/index.tsx";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";

export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  gitRendererPlugin,
  filesRendererPlugin,
  codexRendererPlugin,
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
