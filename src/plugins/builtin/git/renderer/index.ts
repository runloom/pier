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
      // thunk 形式让 locale 切换时 tab 标题实时跟随;manifest 声明该 panel,
      // i18n 通过 panels[id].title 解析,fallback 用插件 messages 的 ui.panelTitle.gitChanges。
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
  id: GIT_PLUGIN_ID,
};
