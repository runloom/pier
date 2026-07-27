import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { isBackgroundPanelId } from "./task-background-panel-id.ts";

/**
 * 进程自然退出时是否保留 terminal surface（任务结果 panel 不自动关）。
 */
export function shouldRetainTaskSurfaceOnProcessExit(args: {
  hasDedicatedPanel(panelId: string, windowId?: string | undefined): boolean;
  panelId: string;
  snapshot: TaskRunsSnapshot;
  windowId?: string | undefined;
}): boolean {
  const { panelId, snapshot, windowId } = args;
  if (isBackgroundPanelId(panelId) || panelId.startsWith("task-output-")) {
    return true;
  }
  for (const run of Object.values(snapshot.runs)) {
    for (const node of Object.values(run.nodes)) {
      if (node.panelId === panelId) {
        return true;
      }
    }
  }
  return args.hasDedicatedPanel(panelId, windowId);
}
