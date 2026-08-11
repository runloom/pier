/**
 * Keep the Files editor language-mode registry + LSP install guides aligned
 * with enabled plugins and L1 custom language servers.
 */

import { syncEditorLanguageModes } from "@plugins/builtin/files/renderer/editor/sync-language-modes.ts";
import { syncLspInstallGuides } from "@plugins/builtin/files/renderer/panel/sync-lsp-install-guides.ts";
import { useLspPreferencesStore } from "@/stores/lsp-preferences.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

function pushSnapshot(): void {
  const plugins = usePluginRegistryStore.getState().plugins;
  const customServers = useLspPreferencesStore.getState().customServers;
  syncEditorLanguageModes({
    customServers,
    plugins,
  });
  // Install commands come from language plugins (and core catalog defaults).
  syncLspInstallGuides({ plugins });
}

/**
 * Subscribe once at app bootstrap. Returns unsubscribe.
 */
export function installEditorLanguageModeSync(): () => void {
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
