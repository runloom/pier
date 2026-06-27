import type { MainPluginModule } from "@plugins/api/main.ts";
import { WORKTREE_PLUGIN_ID } from "@shared/contracts/plugin.ts";

export const worktreeMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: WORKTREE_PLUGIN_ID,
};
