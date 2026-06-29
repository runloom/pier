import { basename } from "node:path";
import type {
  TaskCandidate,
  TaskLaunchPlan,
  TaskListResult,
  TaskRecentEntry,
  TaskRecentState,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import {
  EMPTY_TASK_RECENT_STATE,
  readTaskRecentState as readTaskRecentStateDefault,
  writeTaskRecentState as writeTaskRecentStateDefault,
} from "../../state/task-recent.ts";
import {
  buildTaskLaunches,
  requiredInputsForTask,
} from "./task-execution-plan.ts";
import {
  createTaskRunCoordinator,
  type TaskRunCoordinatorStartResult,
  type TaskRunTerminalOpenResult,
} from "./task-run-coordinator.ts";
import {
  type CollectTaskCandidatesOptions,
  collectTaskCandidates,
} from "./task-sources.ts";

export interface TaskSpawnRequest {
  inputs?: Record<string, string> | undefined;
  projectRoot: string;
  taskId: string;
}

export interface TaskStartedRecord {
  panelId: string;
  projectRoot: string;
  taskId: string;
  windowId?: string | undefined;
}

export interface TaskService {
  cancelRun(runId: string): TaskRunSnapshot | null;
  completePanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  list(args: { projectRoot: string }): Promise<TaskListResult>;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  prepareSpawn(args: TaskSpawnRequest): Promise<TaskSpawnPreparation>;
  recentTasks(): readonly TaskRecentEntry[];
  recordRecent(launch: TaskLaunchPlan): Promise<void>;
  recordStarted(record: TaskStartedRecord): void;
  startRun(args: {
    launches: readonly TaskLaunchPlan[];
    openTerminal(
      launch: TaskLaunchPlan,
      runId: string
    ): Promise<TaskRunTerminalOpenResult>;
    projectRoot: string;
    rootTaskId: string;
  }): Promise<TaskRunCoordinatorStartResult>;
  statusRun(runId: string): TaskRunSnapshot | null;
}

export interface CreateTaskServiceOptions {
  homeDir?: string;
  now?: () => number;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

interface TaskRunInstance {
  kind: "panel";
  panelId: string;
  projectRoot: string;
  startedAt: number;
  taskId: string;
  windowId?: string | undefined;
}

interface TaskRunCoordinatorInstance {
  kind: "coordinator";
  projectRoot: string;
  runId: string;
  startedAt: number;
  taskId: string;
}

type RunningTaskInstance = TaskRunCoordinatorInstance | TaskRunInstance;

interface TaskPanelRef {
  panelId: string;
  windowId?: string | undefined;
}

function runKey(projectRoot: string, taskId: string): string {
  return `${projectRoot}\0${taskId}`;
}

function panelRefKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

function isTerminalRunStatus(status: TaskRunSnapshot["status"]): boolean {
  return (
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded"
  );
}

function focusableRunPanel(
  snapshot: TaskRunSnapshot,
  taskId: string
): TaskPanelRef | null {
  const root = snapshot.nodes[taskId];
  if (root?.status === "running" && root.panelId) {
    return { panelId: root.panelId, windowId: root.windowId };
  }
  const runningNode = Object.values(snapshot.nodes).find(
    (node) => node.status === "running" && node.panelId
  );
  return runningNode?.panelId
    ? { panelId: runningNode.panelId, windowId: runningNode.windowId }
    : null;
}

export function createTaskService({
  homeDir,
  now = () => Date.now(),
  readRecentState = readTaskRecentStateDefault,
  recentLimit = 20,
  writeRecentState = writeTaskRecentStateDefault,
}: CreateTaskServiceOptions = {}): TaskService {
  const runningByKey = new Map<string, RunningTaskInstance>();
  const runningByPanel = new Map<string, Set<string>>();
  const taskRuns = createTaskRunCoordinator({ now });
  let recentTasks: TaskRecentEntry[] = [];
  let recentLoaded = false;
  let recentLoadPromise: Promise<void> | null = null;

  async function ensureRecentLoaded(): Promise<void> {
    if (recentLoaded) {
      return;
    }
    if (recentLoadPromise) {
      return await recentLoadPromise;
    }
    recentLoadPromise = readRecentState()
      .then((state) => {
        recentTasks = state.entries;
        recentLoaded = true;
      })
      .catch(() => {
        recentTasks = EMPTY_TASK_RECENT_STATE.entries;
        recentLoaded = true;
      })
      .finally(() => {
        recentLoadPromise = null;
      });
    await recentLoadPromise;
  }

  const collect = async (projectRoot: string) => {
    await ensureRecentLoaded();
    return await collectTaskCandidates({
      projectRoot,
      recentTasks,
      ...(homeDir ? { homeDir } : {}),
    } satisfies CollectTaskCandidatesOptions);
  };

  function rememberPanelRun(
    panelId: string,
    windowId: string | undefined,
    key: string
  ): void {
    const panelKey = panelRefKey(panelId, windowId);
    const keys = runningByPanel.get(panelKey) ?? new Set<string>();
    keys.add(key);
    runningByPanel.set(panelKey, keys);
  }

  function forgetRunningPanel(
    panelId: string,
    windowId?: string | undefined
  ): void {
    const panelKey = panelRefKey(panelId, windowId);
    const keys = runningByPanel.get(panelKey);
    if (!keys) {
      return;
    }
    runningByPanel.delete(panelKey);
    for (const key of keys) {
      const running = runningByKey.get(key);
      if (
        running?.kind === "panel" &&
        panelRefKey(running.panelId, running.windowId) === panelKey
      ) {
        runningByKey.delete(key);
      }
    }
  }

  function markClosed(panelId: string, windowId?: string | undefined): void {
    taskRuns.markPanelClosed(panelId, windowId);
    forgetRunningPanel(panelId, windowId);
  }

  function recordStartedRun({
    panelId,
    projectRoot,
    taskId,
    windowId,
  }: TaskStartedRecord): void {
    const key = runKey(projectRoot, taskId);
    runningByKey.set(key, {
      kind: "panel",
      panelId,
      projectRoot,
      startedAt: now(),
      taskId,
      ...(windowId ? { windowId } : {}),
    });
    rememberPanelRun(panelId, windowId, key);
  }

  function recordCoordinatorRun({
    projectRoot,
    rootTaskId,
    runId,
  }: {
    projectRoot: string;
    rootTaskId: string;
    runId: string;
  }): void {
    runningByKey.set(runKey(projectRoot, rootTaskId), {
      kind: "coordinator",
      projectRoot,
      runId,
      startedAt: now(),
      taskId: rootTaskId,
    });
  }

  function forgetSnapshotTasks(snapshot: TaskRunSnapshot): void {
    for (const node of Object.values(snapshot.nodes)) {
      runningByKey.delete(runKey(snapshot.projectRoot, node.taskId));
    }
  }

  function resolveRunningPanel(
    key: string,
    running: RunningTaskInstance
  ): TaskPanelRef | null {
    if (running.kind === "panel") {
      return { panelId: running.panelId, windowId: running.windowId };
    }
    const snapshot = taskRuns.status(running.runId);
    if (!snapshot || isTerminalRunStatus(snapshot.status)) {
      runningByKey.delete(key);
      return null;
    }
    const panel = focusableRunPanel(snapshot, running.taskId);
    if (!panel) {
      runningByKey.delete(key);
    }
    return panel;
  }

  function alreadyRunningPreparation(
    projectRoot: string,
    taskId: string
  ): TaskSpawnPreparation | null {
    const key = runKey(projectRoot, taskId);
    const running = runningByKey.get(key);
    const panel = running ? resolveRunningPanel(key, running) : null;
    return panel
      ? {
          panelId: panel.panelId,
          status: "already-running",
          ...(panel.windowId ? { windowId: panel.windowId } : {}),
        }
      : null;
  }

  function buildReadyPreparation(
    task: TaskCandidate,
    tasks: TaskListResult["tasks"],
    inputs: Record<string, string>,
    projectRoot: string
  ): TaskSpawnPreparation {
    try {
      return {
        launches: buildTaskLaunches(task, { inputs, projectRoot }, tasks),
        status: "ready",
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        status: "unsupported",
      };
    }
  }

  async function recordRecentLaunch(launch: TaskLaunchPlan): Promise<void> {
    await ensureRecentLoaded();
    const entry: TaskRecentEntry = {
      command: launch.rawCommand ?? launch.command,
      cwd: launch.cwd,
      label: launch.label || basename(launch.cwd),
      source: "history",
    };
    recentTasks = [
      entry,
      ...recentTasks.filter(
        (recent) =>
          !(recent.cwd === entry.cwd && recent.command === entry.command)
      ),
    ].slice(0, recentLimit);
    await writeRecentState({ entries: recentTasks, version: 1 });
  }

  return {
    cancelRun(runId) {
      const result = taskRuns.cancel(runId);
      if (result) {
        forgetSnapshotTasks(result);
      }
      for (const node of Object.values(result?.nodes ?? {})) {
        if (node.panelId) {
          forgetRunningPanel(node.panelId, node.windowId);
        }
      }
      return result;
    },
    async completePanel(panelId, exitCode, windowId) {
      const result = await taskRuns.completePanel(panelId, exitCode, windowId);
      markClosed(panelId, windowId);
      if (result && isTerminalRunStatus(result.status)) {
        forgetSnapshotTasks(result);
      }
      return result;
    },
    async list({ projectRoot }) {
      return await collect(projectRoot);
    },
    markPanelClosed(panelId, windowId) {
      markClosed(panelId, windowId);
    },
    async prepareSpawn({ projectRoot, taskId, inputs = {} }) {
      const list = await collect(projectRoot);
      const task = list.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        return {
          message: `找不到任务: ${taskId}`,
          status: "unsupported",
        };
      }
      if (task.unsupportedReason) {
        return {
          message: task.unsupportedReason,
          status: "unsupported",
        };
      }
      if (task.concurrencyPolicy === "dedupe") {
        const running = alreadyRunningPreparation(projectRoot, task.id);
        if (running) {
          return running;
        }
      }
      const missingInputs = requiredInputsForTask(task, inputs);
      if (missingInputs.length > 0) {
        return {
          inputs: missingInputs,
          status: "requires-input",
        };
      }
      return buildReadyPreparation(task, list.tasks, inputs, projectRoot);
    },
    recentTasks: () => recentTasks,
    async recordRecent(launch) {
      await recordRecentLaunch(launch);
    },
    recordStarted({ panelId, projectRoot, taskId, windowId }) {
      recordStartedRun({ panelId, projectRoot, taskId, windowId });
    },
    async startRun({ launches, openTerminal, projectRoot, rootTaskId }) {
      const result = await taskRuns.start({
        launches,
        openTerminal: async (launch, runId) => {
          const opened = await openTerminal(launch, runId);
          recordStartedRun({
            panelId: opened.panelId,
            projectRoot: launch.projectRoot,
            taskId: launch.taskId,
            windowId: opened.windowId,
          });
          await recordRecentLaunch(launch);
          return opened;
        },
        projectRoot,
        rootTaskId,
      });
      recordCoordinatorRun({ projectRoot, rootTaskId, runId: result.runId });
      return result;
    },
    statusRun(runId) {
      return taskRuns.status(runId);
    },
  };
}
