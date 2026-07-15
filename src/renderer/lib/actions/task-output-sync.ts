import { maintainTaskOutputPanels } from "@/components/workspace/open-task-output-panel.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/** spawn / restart / workspace ready 后主动维护 Task Output 逻辑视图。 */
export async function scheduleTaskOutputPanelSync(): Promise<boolean> {
  const api = useWorkspaceStore.getState().api;
  const { initialized, snapshot } = useTaskRunsStore.getState();
  if (!(api && initialized)) {
    return false;
  }
  const result = await maintainTaskOutputPanels(api, snapshot);
  if (!result.ok) {
    console.error(
      "[task-output-sync] maintainTaskOutputPanels failed:",
      result.error
    );
  }
  return result.ok;
}
