import type {
  TaskBackgroundSnapshot,
  TaskLaunchPlan,
  TaskOutputUpdate,
  TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";
import type { TaskRunCoordinatorStartResult } from "./task-run-coordinator.ts";

export interface TaskBackgroundRuns {
  cancelPanel(panelId: string, windowId?: string | undefined): void;
  dispose(): void;
  finishPanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  forceStopPanel(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string; ok: boolean };
  output(runId: string, taskId: string): TaskOutputUpdate | null;
  setNodeFromSnapshot(
    projectRootPath: string,
    runId: string,
    node: TaskRunSnapshot["nodes"][string]
  ): void;
  snapshot(): TaskBackgroundSnapshot;
  start(args: {
    clientEnv?: Record<string, string> | undefined;
    launches: readonly TaskLaunchPlan[];
    originPanelId?: string | undefined;
    projectRootPath: string;
    rootTaskId: string;
    windowId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult>;
  stopPanel(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string; ok: boolean };
}
