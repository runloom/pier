import type { DockviewReadyEvent } from "dockview-react";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function createPluginPanelCloserForWorkspace(
  api: DockviewReadyEvent["api"]
): (componentId: string) => void {
  return (componentId: string) => {
    const victims = api.panels.filter(
      (panel) => panel.view.contentComponent === componentId
    );
    if (victims.length === 0) return;
    if (api.totalPanels - victims.length <= 0) {
      useWorkspaceStore.getState().addTab();
    }
    for (const panel of victims) {
      try {
        api.removePanel(panel);
      } catch (error) {
        const wasRemoved = !api.panels.some((item) => item.id === panel.id);
        if (!wasRemoved) {
          throw error;
        }
      }
    }
  };
}

export function createPluginPanelTitleUpdaterForWorkspace(
  api: DockviewReadyEvent["api"]
): (componentId: string, title: string) => void {
  return (componentId, title) => {
    const descriptorStore = usePanelDescriptorStore.getState();
    for (const panel of api.panels) {
      if (panel.view.contentComponent !== componentId) continue;
      try {
        panel.api.setTitle(title);
      } catch {
        // Dockview 可能已随同组首个 panel 一起销毁；单个陈旧句柄不能阻断
        // 其它实例的元数据同步，更不能让插件激活整体回滚。
        continue;
      }
      const current = descriptorStore.descriptors[panel.id];
      descriptorStore.upsert(panel.id, {
        ...(current?.context ? { context: current.context } : {}),
        display: { ...current?.display, short: title },
        ...(current?.tab ? { tab: current.tab } : {}),
      });
    }
  };
}
