import type {
  TaskLaunchPlan,
  TaskRunControlEntry,
  TaskRunNodeStatus,
  TaskRunSnapshot,
  TaskRunsSnapshot,
  TaskSpawnMode,
} from "@shared/contracts/tasks.ts";
import {
  aggregateStatus,
  controlSnapshot,
  panelNodeKey,
  rejectStopForTasks,
  snapshot,
  type TaskRunNodeState,
  type TaskRunState,
} from "./task-run-state.ts";

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
  mode?: TaskSpawnMode | undefined;
  openTerminal?: TaskRunTerminalOpen;
  originPanelId?: string | undefined;
  ownerWindowId?: string | undefined;
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
    windowId?: string | undefined,
    expectedRunId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  controlStatus(runId: string): TaskRunControlEntry | null;
  forceStop(
    runId: string,
    taskIds?: ReadonlySet<string> | undefined
  ): TaskRunControlEntry | null;
  isStopRequested(panelId: string, windowId?: string | undefined): boolean;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  rejectStop(
    runId: string,
    taskIds: ReadonlySet<string>
  ): TaskRunControlEntry | null;
  requestStop(runId: string): TaskRunControlEntry | null;
  runsSnapshot(windowId?: string | undefined): TaskRunsSnapshot;
  start(
    args: TaskRunCoordinatorStartArgs
  ): Promise<TaskRunCoordinatorStartResult>;
  status(runId: string): TaskRunSnapshot | null;
}

export interface CreateTaskRunCoordinatorOptions {
  now?: () => number;
  onChanged?: ((snapshot: TaskRunsSnapshot) => void) | undefined;
  openTerminal?: TaskRunTerminalOpen;
  retainedRunLimit?: number;
}

type DependencyScheduleState = "blocked" | "ready" | "waiting";

function taskRunId(now: number, sequence: number): string {
  return `run-${now.toString(36)}-${sequence.toString(36)}`;
}

export function createTaskRunCoordinator({
  now = () => Date.now(),
  onChanged,
  openTerminal: defaultOpenTerminal,
  retainedRunLimit = 100,
}: CreateTaskRunCoordinatorOptions = {}): TaskRunCoordinator {
  const runs = new Map<string, TaskRunState>();
  const runOpenTerminal = new Map<string, TaskRunTerminalOpen>();
  const panelToRunNode = new Map<string, { runId: string; taskId: string }>();
  let sequence = 0;
  let snapshotVersion = 0;

  const runsSnapshot = (windowId?: string | undefined): TaskRunsSnapshot => ({
    runs: Object.fromEntries(
      [...runs.entries()]
        .filter(([, run]) => !windowId || run.ownerWindowId === windowId)
        .map(([runId, run]) => [runId, controlSnapshot(run)])
    ),
    version: snapshotVersion,
  });

  const publish = (): void => {
    snapshotVersion += 1;
    onChanged?.(runsSnapshot());
  };

  const touch = (run: TaskRunState): void => {
    run.updatedAt = now();
    publish();
  };

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
    touch(run);
    try {
      const opened = await openTerminal(node.launch, run.runId);
      node.panelId = opened.panelId;
      node.windowId = opened.windowId;
      run.ownerWindowId ??= opened.windowId;
      panelToRunNode.set(panelNodeKey(opened.panelId, opened.windowId), {
        runId: run.runId,
        taskId,
      });
      run.panelIds = [...run.panelIds, opened.panelId];
      touch(run);
    } catch (error) {
      node.status = "failed";
      touch(run);
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
    const status = run.nodes.get(dependencyId)?.status ?? "blocked";
    if (status === "failed" || status === "blocked" || status === "cancelled") {
      return "blocked";
    }
    return status === "succeeded" ? "ready" : "waiting";
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
        if (
          node.status === "pending" ||
          node.status === "running" ||
          node.status === "stopping"
        ) {
          node.status = "cancelled";
          if (node.stopRequestedAt !== undefined) {
            node.termination ??= "interrupt";
          }
          if (node.panelId) {
            panelToRunNode.delete(panelNodeKey(node.panelId, node.windowId));
          }
        }
      }
      sweepFinishedRuns();
      touch(run);
      return snapshot(run);
    },
    controlStatus(runId) {
      const run = runs.get(runId);
      return run ? controlSnapshot(run) : null;
    },
    async completePanel(panelId, exitCode, windowId, expectedRunId) {
      const ref = panelToRunNode.get(panelNodeKey(panelId, windowId));
      if (!ref || (expectedRunId && ref.runId !== expectedRunId)) {
        return null;
      }
      const run = runs.get(ref.runId);
      const node = run?.nodes.get(ref.taskId);
      if (!(run && node)) {
        return null;
      }
      node.exitCode = exitCode;
      if (node.status === "cancelled") {
        // Force-stop / panel-close already established the terminal state.
      } else if (node.status === "stopping") {
        node.status = "cancelled";
        node.termination ??= "interrupt";
      } else {
        node.status = exitCode === 0 ? "succeeded" : "failed";
      }
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
      touch(run);
      return snapshot(run);
    },
    forceStop(runId, taskIds) {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }
      let changed = false;
      for (const [taskId, node] of run.nodes) {
        if (
          (!taskIds || taskIds.has(taskId)) &&
          (node.status === "pending" ||
            node.status === "running" ||
            node.status === "stopping")
        ) {
          node.status = "cancelled";
          node.termination = "force";
          changed = true;
        }
      }
      if (changed) {
        sweepFinishedRuns();
        touch(run);
      }
      return controlSnapshot(run);
    },
    isStopRequested(panelId, windowId) {
      const ref = panelToRunNode.get(panelNodeKey(panelId, windowId));
      const node = ref ? runs.get(ref.runId)?.nodes.get(ref.taskId) : undefined;
      return (
        node?.status === "stopping" ||
        (node?.status === "cancelled" && node.termination === "force")
      );
    },
    markPanelClosed(panelId, windowId) {
      const ref = panelToRunNode.get(panelNodeKey(panelId, windowId));
      const run = ref ? runs.get(ref.runId) : undefined;
      const node = ref && run ? run.nodes.get(ref.taskId) : undefined;
      if (node?.status === "running" || node?.status === "stopping") {
        node.status = "cancelled";
        if (node.stopRequestedAt !== undefined) {
          node.termination ??= "interrupt";
        }
      }
      panelToRunNode.delete(panelNodeKey(panelId, node?.windowId ?? windowId));
      sweepFinishedRuns();
      if (run) {
        touch(run);
      }
    },
    rejectStop(runId, taskIds) {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }
      if (rejectStopForTasks(run, taskIds)) {
        touch(run);
      }
      return controlSnapshot(run);
    },
    requestStop(runId) {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }
      const requestedAt = now();
      let changed = false;
      for (const node of run.nodes.values()) {
        if (node.status === "pending") {
          node.status = "cancelled";
          node.stopRequestedAt = requestedAt;
          changed = true;
        } else if (node.status === "running") {
          node.status = "stopping";
          node.stopRequestedAt = requestedAt;
          changed = true;
        }
      }
      if (changed) {
        touch(run);
      }
      return controlSnapshot(run);
    },
    runsSnapshot,
    async start({
      launches,
      mode = "terminal-tab",
      openTerminal,
      originPanelId,
      ownerWindowId,
      projectRootPath,
      rootTaskId,
    }) {
      const terminalOpen = openTerminal ?? defaultOpenTerminal;
      if (!terminalOpen) {
        throw new Error("TaskRunCoordinator requires an openTerminal callback");
      }
      sequence += 1;
      const startedAt = now();
      const runId = taskRunId(startedAt, sequence);
      const run: TaskRunState = {
        mode,
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
        startedAt,
        updatedAt: startedAt,
        ...(originPanelId ? { originPanelId } : {}),
        ...(ownerWindowId ? { ownerWindowId } : {}),
      };
      runs.set(runId, run);
      runOpenTerminal.set(runId, terminalOpen);
      publish();
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
        publish();
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
