import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { GIT_PLUGIN_ID } from "@shared/contracts/plugin.ts";
import { registerGitStatusItem } from "./git-status-item.tsx";
import { registerWorktreeActions } from "./worktree-list-action.ts";

export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerGitStatusItem(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export const gitRendererPlugin: RendererPluginModule = {
  activate: (context) => registerGitPluginContributions(context),
  id: GIT_PLUGIN_ID,
};
