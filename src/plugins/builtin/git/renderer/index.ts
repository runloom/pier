import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { Diff, GitBranch } from "lucide-react";
import { GIT_CHANGES_PANEL_ID, GIT_PLUGIN_ID } from "../manifest.ts";
import { registerGitActions } from "./git-actions.ts";
import { createGitChangesPanel } from "./git-changes-panel.tsx";
import { gitChangesPanelTabChrome } from "./git-changes-tab-title.ts";
import { createGitPanelTransferRegistration } from "./git-panel-transfer.ts";
import { registerGitReviewTreeActions } from "./git-review-tree-actions.ts";
import { registerGitStatusItem } from "./git-status-item.tsx";
import { registerWorktreeActions } from "./worktree-list-action.ts";

function gitChangesTabChromeLabels(context: RendererPluginContext) {
  return {
    branchLabel: context.i18n.t(
      "ui.reviewTabTooltipBranch",
      undefined,
      "Branch"
    ),
    pathLabel: context.i18n.t("ui.reviewTabTooltipPath", undefined, "Path"),
    targetBranchLabel: context.i18n.t(
      "ui.reviewScopeBranch",
      undefined,
      "Branch"
    ),
    targetCommitLabel: context.i18n.t(
      "ui.reviewScopeCommit",
      undefined,
      "Commit"
    ),
    targetLabel: context.i18n.t(
      "ui.reviewTabTooltipTarget",
      undefined,
      "Target"
    ),
    targetUncommittedLabel: context.i18n.t(
      "ui.reviewScopeUncommitted",
      undefined,
      "Uncommitted"
    ),
    typeLabel: context.i18n.t("ui.reviewChangesTitle", undefined, "Changes"),
  };
}

export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    context.panels.register({
      component: createGitChangesPanel(context),
      icon: Diff,
      id: GIT_CHANGES_PANEL_ID,
      kind: "web",
      resolveTab: ({ params }) =>
        gitChangesPanelTabChrome(params, gitChangesTabChromeLabels(context)),
      resourcePolicy: "unmountWhenHidden",
      title: () =>
        context.i18n.t("ui.reviewChangesTitle", undefined, "Changes"),
      transfer: createGitPanelTransferRegistration(),
    }),
    registerWorktreeActions(context),
    registerGitActions(context),
    registerGitReviewTreeActions(context),
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
