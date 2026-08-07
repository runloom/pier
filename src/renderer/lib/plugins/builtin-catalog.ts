import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { installFilesHangBreadcrumbSink } from "@plugins/builtin/files/renderer/hang-breadcrumb.ts";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";
import { noteHangBreadcrumb } from "@/lib/diagnostics/hang-breadcrumb.ts";

/**
 * Files hang trail cannot use preload globals (package boundary). Wire the host
 * sink here — the only allowed host entry that imports builtin plugin modules.
 */
function withFilesHangTrail(
  module: RendererPluginModule
): RendererPluginModule {
  return {
    ...module,
    activate(context) {
      const unbind = installFilesHangBreadcrumbSink(noteHangBreadcrumb);
      const dispose = module.activate(context);
      return () => {
        unbind();
        dispose();
      };
    },
  };
}

export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  gitRendererPlugin,
  withFilesHangTrail(filesRendererPlugin),
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
