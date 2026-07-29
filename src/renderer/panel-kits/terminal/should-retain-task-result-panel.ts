import { shouldRetainTerminalResultPanel } from "@shared/contracts/terminal-end-state.ts";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import { taskOutputFromParams } from "@/panel-kits/terminal/terminal-panel-params.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  taskRunsOwnedByPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { terminalEndStateForPanel } from "@/stores/terminal-end-state.store.ts";

const TASK_OUTPUT_PANEL_ID_PREFIX = "task-output-";

/**
 * 进程退出 / SURFACE_CLOSE 时是否应保留 dockview panel（结果查看）。
 * 覆盖：task / task-output / agent。
 * 判定在 close 回调内动态读取，避免 spawn 与 process-closed 竞态。
 * 谓词与 main 对齐：shared `shouldRetainTerminalResultPanel`。
 */
export function shouldRetainTaskResultPanel(
  panelId: string,
  params?: unknown,
  options?: {
    /** session 仍挂 agent（running/exited）；与 main peek 对齐 */
    hasAgentSession?: boolean | undefined;
  }
): boolean {
  const activity = useForegroundActivityStore.getState().activities[panelId];
  return shouldRetainTerminalResultPanel({
    hasAgentActivity: activity?.kind === "agent",
    hasAgentSession: options?.hasAgentSession === true,
    hasEndState: terminalEndStateForPanel(panelId) != null,
    hasTaskOwnership:
      taskRunsOwnedByPanel(useTaskRunsStore.getState().snapshot, panelId)
        .length > 0,
    hasTaskParams: Boolean(
      taskOutputFromParams(params) || taskPanelMetadataFromParams(params)
    ),
    isTaskOutputPanel: panelId.startsWith(TASK_OUTPUT_PANEL_ID_PREFIX),
  });
}
