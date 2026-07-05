import type { MainPluginModule } from "@plugins/api/main.ts";
import { GIT_PLUGIN_ID } from "../manifest.ts";

export const gitMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: GIT_PLUGIN_ID,
};
