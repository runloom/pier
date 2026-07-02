import type { MainPluginModule } from "@plugins/api/main.ts";
import { FILES_PLUGIN_ID } from "../manifest.ts";

export const filesMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: FILES_PLUGIN_ID,
};
