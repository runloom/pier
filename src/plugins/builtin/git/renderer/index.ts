import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";
import { GIT_PLUGIN_ID } from "../manifest.ts";
import { registerGitActions } from "./git-actions.ts";
import { registerGitStatusItem } from "./git-status-item.tsx";
import { registerWorktreeActions } from "./worktree-list-action.ts";

export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerGitActions(context),
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
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: GitBranch,
  id: GIT_PLUGIN_ID,
};
