import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";
import { GIT_PLUGIN_ID } from "../manifest.ts";
import { registerGitActions } from "./git-actions.ts";
import { registerGitChangesAction } from "./git-changes-action.ts";
import { createGitChangesPanel } from "./git-changes-panel.tsx";
import { registerGitStatusItem } from "./git-status-item.tsx";
import { registerWorktreeActions } from "./worktree-list-action.ts";

export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerGitActions(context),
    registerGitStatusItem(context),
    context.panels.register({
      component: createGitChangesPanel(context),
      // Only serializable params belong in Dockview layout state. The runtime
      // Git API is injected through the registered component closure so restored
      // panels keep working after layout hydration.
      getParams: () => ({
        heading: context.i18n.t(
          "ui.panelTitle.gitChanges",
          undefined,
          "Git Changes"
        ),
        hint: context.i18n.t(
          "ui.panelHint.gitChangesClean",
          undefined,
          "No changes in the working tree"
        ),
      }),
      icon: GitBranch,
      id: "pier.git.changes",
      kind: "web",
      // thunk 形式让 locale 切换时 tab 标题实时跟随;新打开的 panel 取当时 locale,
      // 已打开实例的 tab 标题不会重算(dockview 限制,acknowledged)。
      title: () =>
        context.i18n.t("ui.panelTitle.gitChanges", undefined, "Git Changes"),
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
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: GitBranch,
  id: GIT_PLUGIN_ID,
};
