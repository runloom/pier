import type {
  TaskCandidate,
  TaskLaunchPlan,
  TaskListResult,
  TaskPanelRef,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import { buildTaskLaunches } from "./task-execution-plan.ts";

export interface TaskRunInstance {
  kind: "panel";
  panelId: string;
  projectRootPath: string;
  startedAt: number;
  taskId: string;
  windowId?: string | undefined;
}

export interface TaskRunCoordinatorInstance {
  kind: "coordinator";
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

/** forceRestart=false 时复用已在跑的实例：返回可聚焦的 panel，无可复用返回 null。 */
export function alreadyRunningPreparation(args: {
  deleteRunning(key: string): void;
  isBackgroundPanel(panelId: string): boolean;
  key: string;
  running: RunningTaskInstance | undefined;
  statusRun(runId: string): TaskRunSnapshot | null;
  taskId: string;
}): TaskSpawnPreparation | null {
  const { running } = args;
  if (!running) {
    return null;
  }
  if (running.kind === "panel") {
    return {
      panelId: running.panelId,
      status: "already-running",
      ...(running.windowId ? { windowId: running.windowId } : {}),
    };
  }
  const snapshot = args.statusRun(running.runId);
  if (!snapshot || isTerminalRunStatus(snapshot.status)) {
    args.deleteRunning(args.key);
    return null;
  }
  const rootNode = snapshot.nodes[args.taskId];
  const node =
    rootNode?.panelId === undefined
      ? Object.values(snapshot.nodes).find(
          (candidate) =>
            candidate.panelId !== undefined &&
            !isTerminalRunStatus(candidate.status)
        )
      : rootNode;
  if (!node?.panelId) {
    return null;
  }
  if (args.isBackgroundPanel(node.panelId)) {
    return null;
  }
  return {
    panelId: node.panelId,
    status: "already-running",
    ...(node.windowId ? { windowId: node.windowId } : {}),
  };
}

export function buildReadyPreparation(
  task: TaskCandidate,
  tasks: TaskListResult["tasks"],
  inputs: Record<string, string>,
  projectRootPath: string
): TaskSpawnPreparation {
  try {
    return {
      launches: buildTaskLaunches(task, { inputs, projectRootPath }, tasks),
      status: "ready",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "unsupported",
    };
  }
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
