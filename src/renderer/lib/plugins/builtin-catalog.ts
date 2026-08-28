import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { syncEditorLanguageModes } from "@plugins/builtin/files/renderer/editor/language/sync-modes.ts";
import { installFilesHangBreadcrumbSink } from "@plugins/builtin/files/renderer/hang-breadcrumb.ts";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import { syncLspInstallGuides } from "@plugins/builtin/files/renderer/panel/sync-lsp-install-guides.ts";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";
import { memoryRendererPlugin } from "@plugins/builtin/memory/renderer/index.tsx";
import { noteHangBreadcrumb } from "@/lib/diagnostics/hang-breadcrumb.ts";
import { useLspPreferencesStore } from "@/stores/lsp-preferences.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

/**
 * Keep Files editor language-mode registry + LSP install guides aligned with
 * enabled plugins and L1 custom language servers. Lives here because this is
 * the only host entry allowed to import builtin plugin modules.
 */
export function installEditorLanguageModeSync(): () => void {
  const pushSnapshot = (): void => {
    const plugins = usePluginRegistryStore.getState().plugins;
    const customServers = useLspPreferencesStore.getState().customServers;
    syncEditorLanguageModes({
      customServers,
      plugins,
    });
    // Install commands: L0 language matrix (default core catalog) + optional
    // plugin languageServers contributions.
    syncLspInstallGuides({ plugins });
  };
  pushSnapshot();
  const unsubPlugins = usePluginRegistryStore.subscribe(() => {
    pushSnapshot();
  });
  const unsubLsp = useLspPreferencesStore.subscribe(() => {
    pushSnapshot();
  });
  return () => {
    unsubPlugins();
    unsubLsp();
  };
}

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
  memoryRendererPlugin,
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
