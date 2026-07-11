import {
  TASK_STOP_GRACE_MS,
  type TaskRunControlEntry,
  type TaskRunSnapshot,
  type TaskStopResult,
} from "@shared/contracts/tasks.ts";
import { isBackgroundPanelId } from "./task-background-panel-id.ts";
import type { TaskBackgroundRuns } from "./task-background-runs-contract.ts";
import type { TaskRunCoordinator } from "./task-run-coordinator.ts";
import type { TaskTerminalProcessController } from "./task-service-types.ts";

interface CreateTaskRunStopperOptions {
  backgroundRuns: TaskBackgroundRuns;
  forgetSnapshotTasks(snapshot: TaskRunSnapshot): void;
  getTerminalProcessController(): TaskTerminalProcessController | null;
  now(): number;
  taskRuns: TaskRunCoordinator;
}

function isFinishedControlRun(run: TaskRunControlEntry): boolean {
  return (
    run.status === "blocked" ||
    run.status === "cancelled" ||
    run.status === "failed" ||
    run.status === "succeeded"
  );
}

function invokeTerminalControl(
  action: "forceStop" | "interrupt",
  controller: TaskTerminalProcessController | null,
  panelId: string,
  windowId?: string | undefined
): { message?: string | undefined; ok: boolean } {
  if (!controller) {
    return { message: "terminal process controller unavailable", ok: false };
  }
  return controller[action](panelId, windowId);
}

export function createTaskRunStopper({
  backgroundRuns,
  forgetSnapshotTasks,
  getTerminalProcessController,
  now,
  taskRuns,
}: CreateTaskRunStopperOptions): (
  runId: string,
  force?: boolean
) => TaskStopResult | null {
  return (runId, force = false) => {
    const current = taskRuns.controlStatus(runId);
    if (!current) {
      return null;
    }
    if (isFinishedControlRun(current)) {
      return { failures: [], snapshot: current, status: "already-finished" };
    }

    const failures: TaskStopResult["failures"] = [];
    const requestGracefulStop = (): TaskStopResult => {
      let acceptedCount = 0;
      const rejectedTaskIds = new Set<string>();
      const runningTaskIds = new Set(
        Object.values(current.nodes)
          .filter((node) => node.status === "running")
          .map((node) => node.taskId)
      );
      const stopping = taskRuns.requestStop(runId) ?? current;
      for (const node of Object.values(stopping.nodes)) {
        if (
          !(node.panelId && runningTaskIds.has(node.taskId)) ||
          node.status !== "stopping"
        ) {
          continue;
        }
        if (isBackgroundPanelId(node.panelId)) {
          const result = backgroundRuns.stopPanel(node.panelId, node.windowId);
          if (result.ok) {
            acceptedCount += 1;
          } else {
            rejectedTaskIds.add(node.taskId);
            failures.push({
              message: result.message ?? "failed to interrupt background task",
              taskId: node.taskId,
            });
          }
          continue;
        }
        const result = invokeTerminalControl(
          "interrupt",
          getTerminalProcessController(),
          node.panelId,
          node.windowId
        );
        if (result.ok) {
          acceptedCount += 1;
        } else {
          rejectedTaskIds.add(node.taskId);
          failures.push({
            message: result.message ?? "failed to interrupt terminal task",
            taskId: node.taskId,
          });
        }
      }
      const reconciled =
        rejectedTaskIds.size > 0
          ? (taskRuns.rejectStop(runId, rejectedTaskIds) ?? stopping)
          : stopping;
      if (isFinishedControlRun(reconciled)) {
        forgetSnapshotTasks(reconciled);
      }
      let status: TaskStopResult["status"] = "stopping";
      if (reconciled.status === "cancelled") {
        status = "cancelled";
      } else if (failures.length > 0) {
        status = acceptedCount === 0 ? "rejected" : "partially-stopping";
      }
      return {
        failures,
        snapshot: reconciled,
        status,
      };
    };

    if (force) {
      const stoppingNodes = Object.values(current.nodes).filter(
        (node) => node.status === "stopping"
      );
      if (stoppingNodes.length === 0) {
        return requestGracefulStop();
      }
      const forceAvailable = stoppingNodes.every(
        (node) =>
          node.stopRequestedAt !== undefined &&
          now() - node.stopRequestedAt >= TASK_STOP_GRACE_MS
      );
      if (!forceAvailable) {
        return { failures, snapshot: current, status: "stopping" };
      }
      const stoppedTaskIds = new Set<string>();
      for (const node of stoppingNodes) {
        if (!node.panelId) {
          continue;
        }
        if (isBackgroundPanelId(node.panelId)) {
          const result = backgroundRuns.forceStopPanel(
            node.panelId,
            node.windowId
          );
          if (result.ok) {
            stoppedTaskIds.add(node.taskId);
          } else {
            failures.push({
              message: result.message ?? "failed to force stop background task",
              taskId: node.taskId,
            });
          }
          continue;
        }
        const result = invokeTerminalControl(
          "forceStop",
          getTerminalProcessController(),
          node.panelId,
          node.windowId
        );
        if (result.ok) {
          stoppedTaskIds.add(node.taskId);
        } else {
          failures.push({
            message: result.message ?? "failed to force stop terminal task",
            taskId: node.taskId,
          });
        }
      }
      const stopped = taskRuns.forceStop(runId, stoppedTaskIds) ?? current;
      for (const node of Object.values(stopped.nodes)) {
        if (node.panelId && isBackgroundPanelId(node.panelId)) {
          backgroundRuns.setNodeFromSnapshot(
            stopped.projectRootPath,
            stopped.runId,
            node
          );
        }
      }
      if (isFinishedControlRun(stopped)) {
        forgetSnapshotTasks(stopped);
      }
      return {
        failures,
        snapshot: stopped,
        status: stopped.status === "stopping" ? "stopping" : "force-stopped",
      };
    }
    return requestGracefulStop();
  };
}
