import type {
  TaskLaunchPlan,
  TaskPanelRef,
  TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";

export interface TaskRunInstance {
  kind: "panel";
  panelId: string;
  projectId: string;
  projectRootPath: string;
  startedAt: number;
  taskId: string;
  windowId?: string | undefined;
}

export interface TaskRunCoordinatorInstance {
  kind: "coordinator";
  projectId: string;
  projectRootPath: string;
  runId: string;
  startedAt: number;
  taskId: string;
}

export type RunningTaskInstance = TaskRunCoordinatorInstance | TaskRunInstance;

export interface RestartPreparation {
  restartRunId?: string | undefined;
  reusablePanels?: Record<string, TaskPanelRef> | undefined;
}

export function isTerminalRunStatus(
  status: TaskRunSnapshot["status"]
): boolean {
  return (
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded"
  );
}

function snapshotReusablePanels(
  snapshot: TaskRunSnapshot,
  launches: readonly TaskLaunchPlan[]
): Record<string, TaskPanelRef> | undefined {
  const launchTaskIds = new Set(launches.map((launch) => launch.taskId));
  const reusablePanels: Record<string, TaskPanelRef> = {};
  for (const node of Object.values(snapshot.nodes)) {
    if (node.panelId && launchTaskIds.has(node.taskId)) {
      reusablePanels[node.taskId] = {
        panelId: node.panelId,
        ...(node.windowId ? { windowId: node.windowId } : {}),
      };
    }
  }
  return Object.keys(reusablePanels).length > 0 ? reusablePanels : undefined;
}

function panelRestartPreparation(
  taskId: string,
  running: TaskRunInstance
): { reusablePanels: Record<string, TaskPanelRef> } {
  return {
    reusablePanels: {
      [taskId]: {
        panelId: running.panelId,
        ...(running.windowId ? { windowId: running.windowId } : {}),
      },
    },
  };
}

export function restartPreparation(args: {
  deleteRunning(key: string): void;
  key: string;
  launches: readonly TaskLaunchPlan[];
  reusablePanelsForLaunches(
    launches: readonly TaskLaunchPlan[]
  ): Record<string, TaskPanelRef> | undefined;
  running: RunningTaskInstance | undefined;
  statusRun(runId: string): TaskRunSnapshot | null;
  taskId: string;
}): RestartPreparation {
  if (args.running?.kind === "coordinator") {
    const snapshot = args.statusRun(args.running.runId);
    if (snapshot && !isTerminalRunStatus(snapshot.status)) {
      const reusablePanels = snapshotReusablePanels(snapshot, args.launches);
      return {
        restartRunId: args.running.runId,
        ...(reusablePanels ? { reusablePanels } : {}),
      };
    }
    args.deleteRunning(args.key);
  }
  if (args.running?.kind === "panel") {
    return panelRestartPreparation(args.taskId, args.running);
  }
  const reusablePanels = args.reusablePanelsForLaunches(args.launches);
  return reusablePanels ? { reusablePanels } : {};
}
