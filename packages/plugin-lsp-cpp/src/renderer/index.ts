import type { ExternalRendererPluginModule } from "@pier/plugin-api/renderer";

/** No renderer contributions; install guides + modes come from the manifest. */
export const plugin: ExternalRendererPluginModule = {
  id: "pier.lsp-cpp",
  activate: () => () => undefined,
};
