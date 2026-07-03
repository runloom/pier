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
import { createTaskPanelReuseRegistry } from "./task-panel-reuse-registry.ts";
import {
  recentCommandKey,
  recentTaskKey,
  sortTasksByRecentUse,
} from "./task-recent-ranking.ts";
import {
  createTaskRunCoordinator,
  type TaskRunCoordinatorStartResult,
  type TaskRunTerminalOpenResult,
} from "./task-run-coordinator.ts";
import {
  type CollectTaskCandidatesOptions,
  collectTaskCandidates,
} from "./task-sources.ts";
import {
  restartPreparation as buildRestartPreparation,
  isTerminalRunStatus,
  type RestartPreparation,
  type RunningTaskInstance,
} from "./task-spawn-restart.ts";

export interface TaskSpawnRequest {
  inputs?: Record<string, string> | undefined;
  projectId: string;
  projectRootPath: string;
  taskId: string;
}

export interface TaskStartedRecord {
  panelId: string;
  projectId: string;
  projectRootPath: string;
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
  list(args: {
    projectId: string;
    projectRootPath: string;
  }): Promise<TaskListResult>;
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
    projectId: string;
    projectRootPath: string;
    rootTaskId: string;
  }): Promise<TaskRunCoordinatorStartResult>;
  statusRun(runId: string): TaskRunSnapshot | null;
}

export interface TaskActivityCallbacks {
  /** panel 上任务收到终结事件（exit code / cancel / kill）。 */
  onFinished(
    panelId: string,
    args: {
      status: "success" | "failure" | "cancelled";
      exitCode?: number;
    }
  ): void;
  /** panel 上任务真正开始（terminal opened, launch spec 已提交给 shell）。 */
  onLaunched(
    panelId: string,
    windowId: string | undefined,
    task: { taskId: string; label: string }
  ): void;
}

export interface CreateTaskServiceOptions {
  homeDir?: string;
  now?: () => number;
  /**
   * 任务生命周期广播 hook——上层（app-core 层）注入 foregroundActivityService 的
   * taskLaunched / taskFinished, 让前台活动聚合器收到 task activity。
   * 未注入时 task 生命周期不产生 activity broadcast (test 场景可省)。
   */
  onTaskActivity?: TaskActivityCallbacks;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

function runKey(projectId: string, taskId: string): string {
  return `${projectId}\0${taskId}`;
}

function panelRefKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

export function createTaskService({
  homeDir,
  now = () => Date.now(),
  onTaskActivity,
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

  const collect = async (projectId: string, projectRoot: string) => {
    await ensureRecentLoaded();
    const result = await collectTaskCandidates({
      projectId,
      projectRoot,
      recentTasks,
      ...(homeDir ? { homeDir } : {}),
    } satisfies CollectTaskCandidatesOptions);
    return {
      ...result,
      tasks: sortTasksByRecentUse(result.tasks, recentTasks, now()),
    };
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

  const dedicatedPanels = createTaskPanelReuseRegistry();

  function markProcessFinished(
    panelId: string,
    windowId?: string | undefined
  ): void {
    taskRuns.markPanelClosed(panelId, windowId);
    forgetRunningPanel(panelId, windowId);
  }

  function markPanelActuallyClosed(
    panelId: string,
    windowId?: string | undefined
  ): void {
    taskRuns.markPanelClosed(panelId, windowId);
    forgetRunningPanel(panelId, windowId);
    dedicatedPanels.forget(panelId, windowId);
  }

  function recordStartedRun({
    panelId,
    projectId,
    projectRootPath,
    taskId,
    windowId,
  }: TaskStartedRecord): void {
    const key = runKey(projectId, taskId);
    runningByKey.set(key, {
      kind: "panel",
      panelId,
      projectId,
      projectRootPath,
      startedAt: now(),
      taskId,
      ...(windowId ? { windowId } : {}),
    });
    rememberPanelRun(panelId, windowId, key);
    dedicatedPanels.remember(panelId, windowId, key);
  }

  function recordCoordinatorRun({
    projectId,
    projectRootPath,
    rootTaskId,
    runId,
  }: {
    projectId: string;
    projectRootPath: string;
    rootTaskId: string;
    runId: string;
  }): void {
    runningByKey.set(runKey(projectId, rootTaskId), {
      kind: "coordinator",
      projectId,
      projectRootPath,
      runId,
      startedAt: now(),
      taskId: rootTaskId,
    });
  }

  function forgetSnapshotTasks(snapshot: TaskRunSnapshot): void {
    for (const node of Object.values(snapshot.nodes)) {
      runningByKey.delete(runKey(snapshot.projectId, node.taskId));
    }
  }

  function restartPreparation(
    projectId: string,
    taskId: string,
    launches: readonly TaskLaunchPlan[]
  ): RestartPreparation {
    const key = runKey(projectId, taskId);
    return buildRestartPreparation({
      deleteRunning: (runningKey) => {
        runningByKey.delete(runningKey);
      },
      key,
      launches,
      reusablePanelsForLaunches: (nextLaunches) =>
        dedicatedPanels.reusablePanelsForLaunches(nextLaunches, (launch) =>
          runKey(projectId, launch.taskId)
        ),
      running: runningByKey.get(key),
      statusRun: (runId) => taskRuns.status(runId),
      taskId,
    });
  }

  function buildReadyPreparation(
    task: TaskCandidate,
    tasks: TaskListResult["tasks"],
    inputs: Record<string, string>,
    projectId: string,
    projectRootPath: string
  ): TaskSpawnPreparation {
    try {
      return {
        launches: buildTaskLaunches(
          task,
          { inputs, projectId, projectRootPath },
          tasks
        ),
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
    const usedAt = now();
    const existing = recentTasks.find((recent) =>
      recent.taskId
        ? recentTaskKey(recent.cwd, recent.taskId) ===
          recentTaskKey(launch.cwd, launch.taskId)
        : recentCommandKey(recent.cwd, recent.command) ===
          recentCommandKey(launch.cwd, launch.rawCommand ?? launch.command)
    );
    const entry: TaskRecentEntry = {
      command: launch.rawCommand ?? launch.command,
      cwd: launch.cwd,
      lastUsedAt: usedAt,
      label: launch.label || basename(launch.cwd),
      source: "history",
      taskId: launch.taskId,
      useCount: (existing?.useCount ?? 0) + 1,
    };
    recentTasks = [
      entry,
      ...recentTasks.filter(
        (recent) =>
          !(
            (recent.taskId
              ? recentTaskKey(recent.cwd, recent.taskId) ===
                recentTaskKey(entry.cwd, launch.taskId)
              : false) ||
            recentCommandKey(recent.cwd, recent.command) ===
              recentCommandKey(entry.cwd, entry.command)
          )
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
        if (!node.panelId) {
          continue;
        }
        forgetRunningPanel(node.panelId, node.windowId);
        // 只对本次 cancel 才真正翻状态的节点 fire onFinished（cancelRun 内 coordinator
        // 只把 pending/running 改为 cancelled；succeeded/failed 节点保留原状态）。
        // 无过滤会把已 success 的 activity 在 5s linger 内闪回 cancelled。
        if (node.status === "cancelled") {
          onTaskActivity?.onFinished(node.panelId, { status: "cancelled" });
        }
      }
      return result;
    },
    async completePanel(panelId, exitCode, windowId) {
      const result = await taskRuns.completePanel(panelId, exitCode, windowId);
      markProcessFinished(panelId, windowId);
      if (result && isTerminalRunStatus(result.status)) {
        forgetSnapshotTasks(result);
      }
      if (result) {
        onTaskActivity?.onFinished(panelId, {
          status: exitCode === 0 ? "success" : "failure",
          exitCode,
        });
      }
      return result;
    },
    async list({ projectId, projectRootPath }) {
      return await collect(projectId, projectRootPath);
    },
    markPanelClosed(panelId, windowId) {
      markPanelActuallyClosed(panelId, windowId);
    },
    async prepareSpawn({ projectId, projectRootPath, taskId, inputs = {} }) {
      const list = await collect(projectId, projectRootPath);
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
      const missingInputs = requiredInputsForTask(task, inputs);
      if (missingInputs.length > 0) {
        return {
          inputs: missingInputs,
          status: "requires-input",
        };
      }
      const preparation = buildReadyPreparation(
        task,
        list.tasks,
        inputs,
        projectId,
        projectRootPath
      );
      if (
        preparation.status !== "ready" ||
        task.concurrencyPolicy === "allow-concurrent"
      ) {
        return preparation;
      }
      return {
        ...preparation,
        ...restartPreparation(projectId, task.id, preparation.launches),
      };
    },
    recentTasks: () => recentTasks,
    async recordRecent(launch) {
      await recordRecentLaunch(launch);
    },
    recordStarted({ panelId, projectId, projectRootPath, taskId, windowId }) {
      recordStartedRun({
        panelId,
        projectId,
        projectRootPath,
        taskId,
        windowId,
      });
    },
    async startRun({
      launches,
      openTerminal,
      projectId,
      projectRootPath,
      rootTaskId,
    }) {
      const result = await taskRuns.start({
        launches,
        openTerminal: async (launch, runId) => {
          const opened = await openTerminal(launch, runId);
          recordStartedRun({
            panelId: opened.panelId,
            projectId: launch.projectId,
            projectRootPath: launch.projectRootPath,
            taskId: launch.taskId,
            windowId: opened.windowId,
          });
          await recordRecentLaunch(launch);
          onTaskActivity?.onLaunched(opened.panelId, opened.windowId, {
            taskId: launch.taskId,
            label: launch.label,
          });
          return opened;
        },
        projectId,
        projectRootPath,
        rootTaskId,
      });
      recordCoordinatorRun({
        projectId,
        projectRootPath,
        rootTaskId,
        runId: result.runId,
      });
      return result;
    },
    statusRun(runId) {
      return taskRuns.status(runId);
    },
  };
}
