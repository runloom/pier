import type { MainPluginModule } from "@pier/plugin-api/main";

/** Language modes + servers register from plugin.json via the host. */
export const plugin: MainPluginModule = {
  id: "pier.lsp-cpp",
  activate: () => () => undefined,
};
