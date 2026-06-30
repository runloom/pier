import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { GIT_PLUGIN_ID } from "@shared/contracts/plugin.ts";
import { GitBranch } from "lucide-react";
import { registerGitChangesAction } from "./git-changes-action.ts";
import { GitChangesPanel } from "./git-changes-panel.tsx";
import { registerGitStatusItem } from "./git-status-item.tsx";
import { registerWorktreeActions } from "./worktree-list-action.ts";

export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerGitStatusItem(context),
    context.panels.register({
      component: GitChangesPanel,
      icon: GitBranch,
      id: "pier.git.changes",
      kind: "web",
      title: "Git 变更",
    }),
    registerGitChangesAction(context),
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
