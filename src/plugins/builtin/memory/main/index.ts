import type { MainPluginModule } from "@plugins/api/main.ts";
import { MEMORY_PLUGIN_ID } from "../manifest.ts";

export const memoryMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: MEMORY_PLUGIN_ID,
};
