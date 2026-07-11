import type {
  TaskLaunchPlan,
  TaskRunControlEntry,
  TaskRunControlNode,
  TaskRunNodeSnapshot,
  TaskRunNodeStatus,
  TaskRunSnapshot,
  TaskRunTermination,
  TaskSpawnMode,
} from "@shared/contracts/tasks.ts";

export interface TaskRunNodeState {
  blockedBy?: string | undefined;
  exitCode?: number | undefined;
  launch: TaskLaunchPlan;
  panelId?: string | undefined;
  status: TaskRunNodeStatus;
  stopRequestedAt?: number | undefined;
  termination?: TaskRunTermination | undefined;
  windowId?: string | undefined;
}

export interface TaskRunState {
  mode: TaskSpawnMode;
  nodes: Map<string, TaskRunNodeState>;
  originPanelId?: string | undefined;
  ownerWindowId?: string | undefined;
  panelIds: string[];
  projectRootPath: string;
  rootTaskId: string;
  runId: string;
  startedAt: number;
  updatedAt: number;
}

export function panelNodeKey(
  panelId: string,
  windowId?: string | undefined
): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

function nodeSnapshot(
  taskId: string,
  node: TaskRunNodeState
): TaskRunNodeSnapshot {
  return {
    label: node.launch.label,
    status: node.status,
    taskId,
    ...(node.blockedBy ? { blockedBy: node.blockedBy } : {}),
    ...(node.exitCode === undefined ? {} : { exitCode: node.exitCode }),
    ...(node.panelId ? { panelId: node.panelId } : {}),
    ...(node.windowId ? { windowId: node.windowId } : {}),
  };
}

function controlNodeSnapshot(
  taskId: string,
  node: TaskRunNodeState
): TaskRunControlNode {
  return {
    ...nodeSnapshot(taskId, node),
    ...(node.stopRequestedAt === undefined
      ? {}
      : { stopRequestedAt: node.stopRequestedAt }),
    ...(node.termination ? { termination: node.termination } : {}),
  };
}

function statusRank(status: TaskRunNodeStatus): number {
  switch (status) {
    case "stopping":
      return 7;
    case "failed":
      return 6;
    case "blocked":
      return 5;
    case "cancelled":
      return 4;
    case "running":
      return 3;
    case "pending":
      return 2;
    case "succeeded":
      return 1;
    default:
      return 0;
  }
}

export function aggregateStatus(run: TaskRunState): TaskRunNodeStatus {
  if ([...run.nodes.values()].some((node) => node.status === "stopping")) {
    return "stopping";
  }
  if ([...run.nodes.values()].some((node) => node.status === "running")) {
    return "running";
  }
  const root = run.nodes.get(run.rootTaskId);
  if (root && root.status !== "pending") {
    return root.status;
  }
  return (
    [...run.nodes.values()]
      .map((node) => node.status)
      .sort((a, b) => statusRank(b) - statusRank(a))[0] ?? "pending"
  );
}

export function rejectStopForTasks(
  run: TaskRunState,
  taskIds: ReadonlySet<string>
): boolean {
  let changed = false;
  for (const [taskId, node] of run.nodes) {
    if (taskIds.has(taskId) && node.status === "stopping") {
      node.status = "running";
      node.stopRequestedAt = undefined;
      node.termination = undefined;
      changed = true;
    }
  }
  return changed;
}

export function controlSnapshot(run: TaskRunState): TaskRunControlEntry {
  return {
    mode: run.mode,
    nodes: Object.fromEntries(
      [...run.nodes.entries()].map(([taskId, node]) => [
        taskId,
        controlNodeSnapshot(taskId, node),
      ])
    ),
    projectRootPath: run.projectRootPath,
    rootTaskId: run.rootTaskId,
    runId: run.runId,
    startedAt: run.startedAt,
    status: aggregateStatus(run),
    updatedAt: run.updatedAt,
    ...(run.originPanelId ? { originPanelId: run.originPanelId } : {}),
    ...(run.ownerWindowId ? { ownerWindowId: run.ownerWindowId } : {}),
  };
}

export function snapshot(run: TaskRunState): TaskRunSnapshot {
  return {
    nodes: Object.fromEntries(
      [...run.nodes.entries()].map(([taskId, node]) => [
        taskId,
        nodeSnapshot(taskId, node),
      ])
    ),
    projectRootPath: run.projectRootPath,
    rootTaskId: run.rootTaskId,
    runId: run.runId,
    status: aggregateStatus(run),
  };
}
