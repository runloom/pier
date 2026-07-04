import type {
  TaskLaunchPlan,
  TaskRunNodeSnapshot,
  TaskRunNodeStatus,
  TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";

export type TaskRunLaunchPlan = TaskLaunchPlan;

export interface TaskRunTerminalOpenResult {
  panelId: string;
  windowId?: string | undefined;
}

type TaskRunTerminalOpen = (
  launch: TaskRunLaunchPlan,
  runId: string
) => Promise<TaskRunTerminalOpenResult>;

export interface TaskRunCoordinatorStartArgs {
  launches: readonly TaskRunLaunchPlan[];
  openTerminal?: TaskRunTerminalOpen;
  projectRootPath: string;
  rootTaskId: string;
}

export interface TaskRunCoordinatorStartResult {
  panelIds: string[];
  primaryPanelId?: string | undefined;
  runId: string;
  snapshot: TaskRunSnapshot;
}

export interface TaskRunCoordinator {
  cancel(runId: string): TaskRunSnapshot | null;
  completePanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  start(
    args: TaskRunCoordinatorStartArgs
  ): Promise<TaskRunCoordinatorStartResult>;
  status(runId: string): TaskRunSnapshot | null;
}

export interface CreateTaskRunCoordinatorOptions {
  now?: () => number;
  openTerminal?: TaskRunTerminalOpen;
  retainedRunLimit?: number;
}

interface TaskRunNodeState {
  blockedBy?: string | undefined;
  exitCode?: number | undefined;
  launch: TaskRunLaunchPlan;
  panelId?: string | undefined;
  status: TaskRunNodeStatus;
  windowId?: string | undefined;
}

interface TaskRunState {
  nodes: Map<string, TaskRunNodeState>;
  panelIds: string[];
  projectRootPath: string;
  rootTaskId: string;
  runId: string;
}

type DependencyScheduleState = "blocked" | "ready" | "waiting";

function taskRunId(now: number, sequence: number): string {
  return `run-${now.toString(36)}-${sequence.toString(36)}`;
}

function panelNodeKey(panelId: string, windowId?: string | undefined): string {
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

function statusRank(status: TaskRunNodeStatus): number {
  switch (status) {
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

function aggregateStatus(run: TaskRunState): TaskRunNodeStatus {
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

function snapshot(run: TaskRunState): TaskRunSnapshot {
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

function dependencyStatus(
  node: TaskRunNodeState | undefined
): TaskRunNodeStatus {
  return node?.status ?? "blocked";
}

function dependencyReady(status: TaskRunNodeStatus): boolean {
  return status === "succeeded";
}

function dependencyFailed(status: TaskRunNodeStatus): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}

export function createTaskRunCoordinator({
  now = () => Date.now(),
  openTerminal: defaultOpenTerminal,
  retainedRunLimit = 100,
}: CreateTaskRunCoordinatorOptions = {}): TaskRunCoordinator {
  const runs = new Map<string, TaskRunState>();
  const runOpenTerminal = new Map<string, TaskRunTerminalOpen>();
  const panelToRunNode = new Map<string, { runId: string; taskId: string }>();
  let sequence = 0;

  const isTerminalStatus = (status: TaskRunNodeStatus): boolean =>
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded";

  const sweepFinishedRuns = (): void => {
    if (retainedRunLimit <= 0) {
      runs.clear();
      runOpenTerminal.clear();
      panelToRunNode.clear();
      return;
    }
    const finishedRunIds = [...runs.entries()]
      .filter(([, run]) => isTerminalStatus(aggregateStatus(run)))
      .map(([runId]) => runId);
    while (finishedRunIds.length > retainedRunLimit) {
      const runId = finishedRunIds.shift();
      if (!runId) {
        return;
      }
      const run = runs.get(runId);
      for (const panelId of run?.panelIds ?? []) {
        const node = [...(run?.nodes.values() ?? [])].find(
          (candidate) => candidate.panelId === panelId
        );
        panelToRunNode.delete(panelNodeKey(panelId, node?.windowId));
      }
      runs.delete(runId);
      runOpenTerminal.delete(runId);
    }
  };

  const openNode = async (
    run: TaskRunState,
    taskId: string,
    node: TaskRunNodeState,
    openTerminal: TaskRunTerminalOpen
  ): Promise<void> => {
    if (node.status !== "pending") {
      return;
    }
    node.status = "running";
    try {
      const opened = await openTerminal(node.launch, run.runId);
      node.panelId = opened.panelId;
      node.windowId = opened.windowId;
      panelToRunNode.set(panelNodeKey(opened.panelId, opened.windowId), {
        runId: run.runId,
        taskId,
      });
      run.panelIds = [...run.panelIds, opened.panelId];
    } catch (error) {
      node.status = "failed";
      throw error;
    }
  };

  const blockNode = (node: TaskRunNodeState, blockedBy: string): void => {
    if (node.status !== "pending") {
      return;
    }
    node.status = "blocked";
    node.blockedBy = blockedBy;
  };

  const dependencyScheduleState = (
    run: TaskRunState,
    dependencyId: string
  ): DependencyScheduleState => {
    const status = dependencyStatus(run.nodes.get(dependencyId));
    if (dependencyFailed(status)) {
      return "blocked";
    }
    return dependencyReady(status) ? "ready" : "waiting";
  };

  const ensureSequenceDependencies = async (
    run: TaskRunState,
    node: TaskRunNodeState,
    dependencies: readonly string[],
    openTerminal: TaskRunTerminalOpen
  ): Promise<DependencyScheduleState> => {
    for (const dependencyId of dependencies) {
      const state = dependencyScheduleState(run, dependencyId);
      if (state === "blocked") {
        blockNode(node, dependencyId);
        return "blocked";
      }
      if (state === "waiting") {
        await ensureNode(run, dependencyId, openTerminal);
        return "waiting";
      }
    }
    return "ready";
  };

  const ensureParallelDependencies = async (
    run: TaskRunState,
    node: TaskRunNodeState,
    dependencies: readonly string[],
    openTerminal: TaskRunTerminalOpen
  ): Promise<DependencyScheduleState> => {
    for (const dependencyId of dependencies) {
      const state = dependencyScheduleState(run, dependencyId);
      if (state === "blocked") {
        blockNode(node, dependencyId);
        return "blocked";
      }
      if (state === "waiting") {
        await ensureNode(run, dependencyId, openTerminal);
      }
    }
    return dependencies.every(
      (dependencyId) => dependencyScheduleState(run, dependencyId) === "ready"
    )
      ? "ready"
      : "waiting";
  };

  const ensureNode = async (
    run: TaskRunState,
    taskId: string,
    openTerminal: TaskRunTerminalOpen
  ): Promise<void> => {
    const node = run.nodes.get(taskId);
    if (node?.status !== "pending") {
      return;
    }
    const dependencies = node.launch.dependsOn ?? [];
    if (dependencies.length === 0) {
      await openNode(run, taskId, node, openTerminal);
      return;
    }

    const scheduleState =
      node.launch.dependsOrder === "sequence"
        ? await ensureSequenceDependencies(
            run,
            node,
            dependencies,
            openTerminal
          )
        : await ensureParallelDependencies(
            run,
            node,
            dependencies,
            openTerminal
          );
    if (scheduleState === "ready") {
      await openNode(run, taskId, node, openTerminal);
    }
  };

  const schedule = async (
    run: TaskRunState,
    openTerminal: TaskRunTerminalOpen
  ): Promise<void> => {
    await ensureNode(run, run.rootTaskId, openTerminal);
  };

  return {
    cancel(runId) {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }
      for (const node of run.nodes.values()) {
        if (node.status === "pending" || node.status === "running") {
          node.status = "cancelled";
          if (node.panelId) {
            panelToRunNode.delete(panelNodeKey(node.panelId, node.windowId));
          }
        }
      }
      sweepFinishedRuns();
      return snapshot(run);
    },
    async completePanel(panelId, exitCode, windowId) {
      const ref = panelToRunNode.get(panelNodeKey(panelId, windowId));
      if (!ref) {
        return null;
      }
      const run = runs.get(ref.runId);
      const node = run?.nodes.get(ref.taskId);
      if (!(run && node)) {
        return null;
      }
      node.exitCode = exitCode;
      node.status = exitCode === 0 ? "succeeded" : "failed";
      panelToRunNode.delete(panelNodeKey(panelId, node.windowId));
      const openTerminal = runOpenTerminal.get(run.runId);
      if (openTerminal) {
        try {
          await schedule(run, openTerminal);
        } catch {
          // The node that failed to open is already marked failed by openNode.
        }
      }
      sweepFinishedRuns();
      return snapshot(run);
    },
    markPanelClosed(panelId, windowId) {
      const ref = panelToRunNode.get(panelNodeKey(panelId, windowId));
      const run = ref ? runs.get(ref.runId) : undefined;
      const node = ref && run ? run.nodes.get(ref.taskId) : undefined;
      if (node?.status === "running") {
        node.status = "cancelled";
      }
      panelToRunNode.delete(panelNodeKey(panelId, node?.windowId ?? windowId));
      sweepFinishedRuns();
    },
    async start({ launches, openTerminal, projectRootPath, rootTaskId }) {
      const terminalOpen = openTerminal ?? defaultOpenTerminal;
      if (!terminalOpen) {
        throw new Error("TaskRunCoordinator requires an openTerminal callback");
      }
      sequence += 1;
      const runId = taskRunId(now(), sequence);
      const run: TaskRunState = {
        nodes: new Map(
          launches.map((launch) => [
            launch.taskId,
            {
              launch,
              status: "pending" as const,
            },
          ])
        ),
        panelIds: [],
        projectRootPath,
        rootTaskId,
        runId,
      };
      runs.set(runId, run);
      runOpenTerminal.set(runId, terminalOpen);
      try {
        await schedule(run, terminalOpen);
      } catch (error) {
        for (const panelId of run.panelIds) {
          const node = [...run.nodes.values()].find(
            (candidate) => candidate.panelId === panelId
          );
          panelToRunNode.delete(panelNodeKey(panelId, node?.windowId));
        }
        runs.delete(runId);
        runOpenTerminal.delete(runId);
        throw error;
      }
      return {
        panelIds: run.panelIds,
        ...(run.panelIds[0] ? { primaryPanelId: run.panelIds[0] } : {}),
        runId,
        snapshot: snapshot(run),
      };
    },
    status(runId) {
      const run = runs.get(runId);
      return run ? snapshot(run) : null;
    },
  };
}
