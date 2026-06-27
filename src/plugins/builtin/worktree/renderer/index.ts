import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { WORKTREE_PLUGIN_ID } from "@shared/contracts/plugin.ts";
import { registerWorktreeActions } from "./worktree-list-action.ts";
import { registerWorktreeStatusItem } from "./worktree-status-item.tsx";

export function registerWorktreePluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerWorktreeStatusItem(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export const worktreeRendererPlugin: RendererPluginModule = {
  activate: (context) => registerWorktreePluginContributions(context),
  id: WORKTREE_PLUGIN_ID,
};
