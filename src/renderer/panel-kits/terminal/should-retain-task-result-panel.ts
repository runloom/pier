import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import { taskOutputFromParams } from "@/panel-kits/terminal/terminal-panel-params.ts";
import {
  taskRunsOwnedByPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";

const TASK_OUTPUT_PANEL_ID_PREFIX = "task-output-";

/**
 * 进程退出 / SURFACE_CLOSE 时是否应保留 dockview panel。
 * 判定在 close 回调内动态读取，避免 spawn 与 process-closed 竞态。
 */
export function shouldRetainTaskResultPanel(
  panelId: string,
  params?: unknown
): boolean {
  if (panelId.startsWith(TASK_OUTPUT_PANEL_ID_PREFIX)) {
    return true;
  }
  if (taskOutputFromParams(params) || taskPanelMetadataFromParams(params)) {
    return true;
  }
  return (
    taskRunsOwnedByPanel(useTaskRunsStore.getState().snapshot, panelId).length >
    0
  );
}
