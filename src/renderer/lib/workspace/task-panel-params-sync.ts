import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/** relaunch / spawn 成功后把 dockview params 与活体 task 元数据对齐，消除 layout reload stale。 */
export function syncTaskPanelParams(
  panelId: string,
  patch: {
    tab?: PanelTabChrome;
    task?: TaskPanelMetadata;
  }
): void {
  const api = useWorkspaceStore.getState().api;
  const panel = api?.panels.find((candidate) => candidate.id === panelId);
  if (!panel) {
    return;
  }
  const rootParams =
    panel.params && typeof panel.params === "object"
      ? (panel.params as Record<string, unknown>)
      : {};
  panel.api.updateParameters({
    ...rootParams,
    ...patch,
  });
}
