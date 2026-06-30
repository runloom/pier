import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/**
 * 以单例方式打开 git-changes 面板:已存在则聚焦,否则在右侧新建。
 * 逻辑独立于 workspace.store(避免该 store 触达上帝文件上限),归属 git-changes 域。
 */
export function openGitChangesPanel(): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const existing = api.panels.find((panel) => panel.id === "git-changes");
  if (existing) {
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  api.addPanel({
    id: "git-changes",
    component: "gitChanges",
    title: "Git 变更",
    position: { direction: "right" },
  });
  scheduleRevealDockviewTabByPanelId("git-changes");
}
