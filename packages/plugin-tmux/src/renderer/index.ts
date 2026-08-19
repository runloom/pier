import type { ExternalRendererPluginModule } from "@pier/plugin-api/renderer";
import { PLUGIN_ID } from "../main/settings-keys.ts";

export const plugin: ExternalRendererPluginModule = {
  id: PLUGIN_ID,
  activate() {
    return () => undefined;
  },
};
