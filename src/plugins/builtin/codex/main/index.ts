import type { MainPluginModule } from "@plugins/api/main.ts";
import { CODEX_PLUGIN_ID } from "../manifest.ts";

export const codexMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: CODEX_PLUGIN_ID,
};
