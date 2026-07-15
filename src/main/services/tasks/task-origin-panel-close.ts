import {
  isActiveTaskRunNodeStatus,
  type TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";
import { isBackgroundPanelId } from "./task-background-panel-id.ts";
import type { TaskBackgroundRuns } from "./task-background-runs-contract.ts";
import type { TaskRunCoordinator } from "./task-run-coordinator.ts";

interface StopBackgroundRunsForOriginPanelCloseOptions {
  backgroundRuns: TaskBackgroundRuns;
  forgetSnapshotTasks(snapshot: TaskRunSnapshot): void;
  panelId: string;
  taskRuns: TaskRunCoordinator;
}

/** 关闭发起终端时，终止其绑定的 background run（绕过 stopRun grace 两阶段）。 */
export function stopBackgroundRunsForOriginPanelClose({
  backgroundRuns,
  forgetSnapshotTasks,
  panelId,
  taskRuns,
}: StopBackgroundRunsForOriginPanelCloseOptions): void {
  const snapshot = taskRuns.runsSnapshot();
  for (const run of Object.values(snapshot.runs)) {
    if (
      run.mode !== "background" ||
      run.originPanelId !== panelId ||
      !isActiveTaskRunNodeStatus(run.status)
    ) {
      continue;
    }
    taskRuns.requestStop(run.runId);
    const stopping =
      taskRuns.controlStatus(run.runId) ??
      taskRuns.runsSnapshot().runs[run.runId];
    if (!stopping) {
      continue;
    }
    const stoppedTaskIds = new Set<string>();
    for (const node of Object.values(stopping.nodes)) {
      if (
        !(
          node.panelId &&
          isBackgroundPanelId(node.panelId) &&
          (node.status === "stopping" || node.status === "running")
        )
      ) {
        continue;
      }
      const result = backgroundRuns.forceStopPanel(node.panelId, node.windowId);
      if (result.ok) {
        stoppedTaskIds.add(node.taskId);
      }
    }
    const forced = taskRuns.forceStop(run.runId, stoppedTaskIds);
    if (forced && !isActiveTaskRunNodeStatus(forced.status)) {
      forgetSnapshotTasks(forced);
    }
  }
}
