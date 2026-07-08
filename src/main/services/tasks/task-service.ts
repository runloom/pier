import type {
  TaskBackgroundRunSnapshot,
  TaskBackgroundSnapshot,
  TaskCandidate,
  TaskLaunchPlan,
  TaskListResult,
  TaskRecentEntry,
  TaskRecentState,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentService } from "../process-environment-service.ts";
import {
  type BackgroundTaskProcess,
  type SpawnBackgroundTask,
  spawnBackgroundTask,
} from "./task-background-runner.ts";
import {
  buildTaskLaunches,
  requiredInputsForTask,
} from "./task-execution-plan.ts";
import { createTaskPanelReuseRegistry } from "./task-panel-reuse-registry.ts";
import {
  createTaskRecentLauncher,
  type TaskRecentLauncher,
} from "./task-recent-launcher.ts";
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
  forceRestart?: boolean | undefined;
  inputs?: Record<string, string> | undefined;
  projectRootPath: string;
  taskId: string;
}

export interface TaskStartedRecord {
  panelId: string;
  projectRootPath: string;
  taskId: string;
  windowId?: string | undefined;
}

export interface TaskService {
  backgroundSnapshot(): TaskBackgroundSnapshot;
  cancelRun(runId: string): TaskRunSnapshot | null;
  completePanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  dispose(): void;
  list(args: { projectRootPath: string }): Promise<TaskListResult>;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  prepareSpawn(args: TaskSpawnRequest): Promise<TaskSpawnPreparation>;
  recentTasks(): readonly TaskRecentEntry[];
  recordRecent(launch: TaskLaunchPlan): Promise<void>;
  recordStarted(record: TaskStartedRecord): void;
  startBackgroundRun(args: {
    clientEnv?: Record<string, string> | undefined;
    launches: readonly TaskLaunchPlan[];
    projectRootPath: string;
    rootTaskId: string;
    windowId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult>;
  startRun(args: {
    launches: readonly TaskLaunchPlan[];
    openTerminal(
      launch: TaskLaunchPlan,
      runId: string
    ): Promise<TaskRunTerminalOpenResult>;
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
  onBackgroundTasksChanged?: (snapshot: TaskBackgroundSnapshot) => void;
  /**
   * 任务生命周期广播 hook——上层（app-core 层）注入 foregroundActivityService 的
   * taskLaunched / taskFinished, 让前台活动聚合器收到 task activity。
   * 未注入时 task 生命周期不产生 activity broadcast (test 场景可省)。
   */
  onTaskActivity?: TaskActivityCallbacks;
  processEnvironment?: ProcessEnvironmentService;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  spawnBackgroundTask?: SpawnBackgroundTask;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}
const TASK_LIST_CACHE_TTL_MS = 2000;
const BACKGROUND_PANEL_ID_PREFIX = "background-task:";
function runKey(projectRootPath: string, taskId: string): string {
  return `${projectRootPath}\0${taskId}`;
}

function panelRefKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

function backgroundPanelId(runId: string, taskId: string): string {
  return `${BACKGROUND_PANEL_ID_PREFIX}${runId}:${taskId}`;
}

function isBackgroundPanelId(panelId: string): boolean {
  return panelId.startsWith(BACKGROUND_PANEL_ID_PREFIX);
}

export function createTaskService({
  homeDir,
  now = () => Date.now(),
  onBackgroundTasksChanged,
  onTaskActivity,
  processEnvironment,
  readRecentState,
  recentLimit,
  spawnBackgroundTask: spawnBackgroundTaskOption = spawnBackgroundTask,
  writeRecentState,
}: CreateTaskServiceOptions = {}): TaskService {
  const runningByKey = new Map<string, RunningTaskInstance>();
  const runningByPanel = new Map<string, Set<string>>();
  const taskRuns = createTaskRunCoordinator({ now });
  const backgroundRunsByProject = new Map<
    string,
    Map<string, TaskBackgroundRunSnapshot>
  >();
  const backgroundProcesses = new Map<
    string,
    {
      panelId: string;
      process?: BackgroundTaskProcess | undefined;
      projectRootPath: string;
      runId: string;
      taskId: string;
      windowId?: string | undefined;
    }
  >();
  const backgroundSpawnTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  const cancelledBackgroundProcessKeys = new Set<string>();
  let disposed = false;
  let backgroundVersion = 0;
  const recent: TaskRecentLauncher = createTaskRecentLauncher({
    now,
    ...(readRecentState ? { readRecentState } : {}),
    ...(recentLimit == null ? {} : { recentLimit }),
    ...(writeRecentState ? { writeRecentState } : {}),
  });

  const collectCache = new Map<
    string,
    { expiresAt: number; result: TaskListResult }
  >();
  const collectVersions = new Map<string, number>();
  const collectInFlight = new Map<
    string,
    { promise: Promise<TaskListResult>; version: number }
  >();

  const collectFresh = async (projectRootPath: string) => {
    await recent.ensureLoaded();
    const result = await collectTaskCandidates({
      projectRootPath,
      recentTasks: recent.entries(),
      ...(homeDir ? { homeDir } : {}),
    } satisfies CollectTaskCandidatesOptions);
    return { ...result, tasks: recent.sort(result.tasks) };
  };

  const collect = async (projectRootPath: string) => {
    const cached = collectCache.get(projectRootPath);
    if (cached && cached.expiresAt > now()) {
      return cached.result;
    }
    const version = collectVersions.get(projectRootPath) ?? 0;
    const pending = collectInFlight.get(projectRootPath);
    if (pending && pending.version === version) {
      return await pending.promise;
    }
    const next = collectFresh(projectRootPath)
      .then((result) => {
        if ((collectVersions.get(projectRootPath) ?? 0) === version) {
          collectCache.set(projectRootPath, {
            expiresAt: now() + TASK_LIST_CACHE_TTL_MS,
            result,
          });
        }
        return result;
      })
      .finally(() => {
        if (collectInFlight.get(projectRootPath)?.promise === next) {
          collectInFlight.delete(projectRootPath);
        }
      });
    collectInFlight.set(projectRootPath, { promise: next, version });
    return await next;
  };

  function invalidateCollectCache(projectRootPath: string): void {
    collectCache.delete(projectRootPath);
    collectVersions.set(
      projectRootPath,
      (collectVersions.get(projectRootPath) ?? 0) + 1
    );
  }

  function backgroundSnapshot(): TaskBackgroundSnapshot {
    return {
      runs: Object.fromEntries(
        [...backgroundRunsByProject.entries()].map(
          ([projectRootPath, runs]) => [
            projectRootPath,
            Object.fromEntries(runs.entries()),
          ]
        )
      ),
      version: backgroundVersion,
    };
  }

  function publishBackgroundSnapshot(): void {
    backgroundVersion += 1;
    onBackgroundTasksChanged?.(backgroundSnapshot());
  }

  function setBackgroundRun(
    projectRootPath: string,
    taskId: string,
    snapshot: TaskBackgroundRunSnapshot
  ): void {
    const projectRuns =
      backgroundRunsByProject.get(projectRootPath) ??
      new Map<string, TaskBackgroundRunSnapshot>();
    projectRuns.set(taskId, snapshot);
    backgroundRunsByProject.set(projectRootPath, projectRuns);
    publishBackgroundSnapshot();
  }

  function updateBackgroundRun(
    projectRootPath: string,
    taskId: string,
    patch: Partial<TaskBackgroundRunSnapshot>
  ): void {
    const current = backgroundRunsByProject.get(projectRootPath)?.get(taskId);
    if (!current) {
      return;
    }
    setBackgroundRun(projectRootPath, taskId, {
      ...current,
      ...patch,
      updatedAt: now(),
    });
  }

  function findBackgroundRunPeer(
    projectRootPath: string,
    runId: string
  ): TaskBackgroundRunSnapshot | undefined {
    const projectRuns = backgroundRunsByProject.get(projectRootPath);
    if (!projectRuns) {
      return;
    }
    return [...projectRuns.values()].find((run) => run.runId === runId);
  }

  function setBackgroundNodeFromSnapshot(
    projectRootPath: string,
    runId: string,
    node: TaskRunSnapshot["nodes"][string]
  ): void {
    const current = backgroundRunsByProject
      .get(projectRootPath)
      ?.get(node.taskId);
    const peer = current ?? findBackgroundRunPeer(projectRootPath, runId);
    const hasBackgroundPanel = node.panelId
      ? isBackgroundPanelId(node.panelId)
      : false;
    const shouldPublish =
      Boolean(current) ||
      hasBackgroundPanel ||
      (Boolean(peer) && isTerminalRunStatus(node.status));
    if (!shouldPublish) {
      return;
    }
    const timestamp = now();
    const nodeWindowId = node.windowId ?? current?.windowId ?? peer?.windowId;
    setBackgroundRun(projectRootPath, node.taskId, {
      label: node.label,
      projectRootPath,
      runId,
      startedAt: current?.startedAt ?? peer?.startedAt ?? timestamp,
      status: node.status,
      taskId: node.taskId,
      updatedAt: timestamp,
      ...(node.exitCode === undefined ? {} : { exitCode: node.exitCode }),
      ...(isTerminalRunStatus(node.status) ? { finishedAt: timestamp } : {}),
      ...(nodeWindowId ? { windowId: nodeWindowId } : {}),
    });
  }

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

  async function finishBackgroundPanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null> {
    const processKey = panelRefKey(panelId, windowId);
    const processRecord = backgroundProcesses.get(processKey);
    backgroundProcesses.delete(processKey);
    try {
      const result = await taskRuns.completePanel(panelId, exitCode, windowId);
      if (!result) {
        return null;
      }
      for (const node of Object.values(result.nodes)) {
        setBackgroundNodeFromSnapshot(
          result.projectRootPath,
          result.runId,
          node
        );
      }
      if (isTerminalRunStatus(result.status)) {
        forgetSnapshotTasks(result);
      }
      return result;
    } catch (err) {
      console.error("[tasks] background task completion failed:", err);
      if (processRecord) {
        updateBackgroundRun(
          processRecord.projectRootPath,
          processRecord.taskId,
          {
            exitCode,
            finishedAt: now(),
            status: exitCode === 0 ? "succeeded" : "failed",
          }
        );
      }
      return null;
    }
  }

  function cancelBackgroundPanel(
    panelId: string,
    windowId?: string | undefined
  ): void {
    const processKey = panelRefKey(panelId, windowId);
    const spawnTimer = backgroundSpawnTimers.get(processKey);
    if (spawnTimer) {
      clearTimeout(spawnTimer);
      backgroundSpawnTimers.delete(processKey);
    }
    const processRecord = backgroundProcesses.get(processKey);
    backgroundProcesses.delete(processKey);
    cancelledBackgroundProcessKeys.add(processKey);
    if (processRecord) {
      processRecord.process?.kill();
      updateBackgroundRun(processRecord.projectRootPath, processRecord.taskId, {
        finishedAt: now(),
        status: "cancelled",
      });
    }
    taskRuns.markPanelClosed(panelId, windowId);
    forgetRunningPanel(panelId, windowId);
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const spawnTimer of backgroundSpawnTimers.values()) {
      clearTimeout(spawnTimer);
    }
    backgroundSpawnTimers.clear();
    const panelRefs = [...backgroundProcesses.values()].map((record) => ({
      panelId: record.panelId,
      windowId: record.windowId,
    }));
    for (const ref of panelRefs) {
      cancelBackgroundPanel(ref.panelId, ref.windowId);
    }
    cancelledBackgroundProcessKeys.clear();
  }

  function recordStartedRun({
    panelId,
    projectRootPath,
    taskId,
    windowId,
  }: TaskStartedRecord): void {
    const key = runKey(projectRootPath, taskId);
    runningByKey.set(key, {
      kind: "panel",
      panelId,
      projectRootPath,
      startedAt: now(),
      taskId,
      ...(windowId ? { windowId } : {}),
    });
    rememberPanelRun(panelId, windowId, key);
    dedicatedPanels.remember(panelId, windowId, key);
  }

  function recordCoordinatorRun({
    projectRootPath,
    rootTaskId,
    runId,
  }: {
    projectRootPath: string;
    rootTaskId: string;
    runId: string;
  }): void {
    runningByKey.set(runKey(projectRootPath, rootTaskId), {
      kind: "coordinator",
      projectRootPath,
      runId,
      startedAt: now(),
      taskId: rootTaskId,
    });
  }

  function forgetSnapshotTasks(snapshot: TaskRunSnapshot): void {
    for (const node of Object.values(snapshot.nodes)) {
      runningByKey.delete(runKey(snapshot.projectRootPath, node.taskId));
    }
  }

  function alreadyRunningPreparation(
    projectRootPath: string,
    taskId: string
  ): TaskSpawnPreparation | null {
    const key = runKey(projectRootPath, taskId);
    const running = runningByKey.get(key);
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
    const snapshot = taskRuns.status(running.runId);
    if (!snapshot || isTerminalRunStatus(snapshot.status)) {
      runningByKey.delete(key);
      return null;
    }
    const rootNode = snapshot.nodes[taskId];
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
    if (isBackgroundPanelId(node.panelId)) {
      return null;
    }
    return {
      panelId: node.panelId,
      status: "already-running",
      ...(node.windowId ? { windowId: node.windowId } : {}),
    };
  }

  function restartPreparation(
    projectRootPath: string,
    taskId: string,
    launches: readonly TaskLaunchPlan[]
  ): RestartPreparation {
    const key = runKey(projectRootPath, taskId);
    return buildRestartPreparation({
      deleteRunning: (runningKey) => {
        runningByKey.delete(runningKey);
      },
      key,
      launches,
      reusablePanelsForLaunches: (nextLaunches) =>
        dedicatedPanels.reusablePanelsForLaunches(nextLaunches, (launch) =>
          runKey(projectRootPath, launch.taskId)
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
  return {
    backgroundSnapshot,
    cancelRun(runId) {
      const result = taskRuns.cancel(runId);
      if (!result) {
        return null;
      }
      forgetSnapshotTasks(result);
      for (const node of Object.values(result.nodes)) {
        if (!node.panelId) {
          continue;
        }
        if (isBackgroundPanelId(node.panelId)) {
          cancelBackgroundPanel(node.panelId, node.windowId);
          if (node.status === "cancelled") {
            setBackgroundNodeFromSnapshot(result.projectRootPath, runId, node);
          }
          continue;
        }
        forgetRunningPanel(node.panelId, node.windowId);
        // 只对本次 cancel 才真正翻状态的节点 fire onFinished（cancelRun 内 coordinator
        // 只把 pending/running 改为 cancelled；succeeded/failed 节点保留原状态）。
        // 无过滤会把已 success 的 activity 覆盖为 cancelled（终态常驻后即永久谎报）。
        if (node.status === "cancelled") {
          onTaskActivity?.onFinished(node.panelId, { status: "cancelled" });
        }
      }
      return result;
    },
    dispose,
    async completePanel(panelId, exitCode, windowId) {
      if (isBackgroundPanelId(panelId)) {
        return await finishBackgroundPanel(panelId, exitCode, windowId);
      }
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
    async list({ projectRootPath }) {
      return await collect(projectRootPath);
    },
    markPanelClosed(panelId, windowId) {
      if (isBackgroundPanelId(panelId)) {
        cancelBackgroundPanel(panelId, windowId);
        return;
      }
      markPanelActuallyClosed(panelId, windowId);
    },
    async prepareSpawn({
      forceRestart = true,
      projectRootPath,
      taskId,
      inputs = {},
    }) {
      if (!forceRestart) {
        const running = alreadyRunningPreparation(projectRootPath, taskId);
        if (running) {
          return running;
        }
      }
      const list = await collect(projectRootPath);
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
        ...restartPreparation(projectRootPath, task.id, preparation.launches),
      };
    },
    recentTasks: () => recent.entries(),
    async recordRecent(launch) {
      await recent.recordLaunch(launch);
      invalidateCollectCache(launch.projectRootPath);
    },
    recordStarted({ panelId, projectRootPath, taskId, windowId }) {
      recordStartedRun({
        panelId,
        projectRootPath,
        taskId,
        windowId,
      });
    },
    async startBackgroundRun({
      clientEnv,
      launches,
      projectRootPath,
      rootTaskId,
      windowId,
    }) {
      if (disposed) {
        throw new Error("TaskService has been disposed");
      }
      if (!processEnvironment) {
        throw new Error(
          "TaskService requires processEnvironment for background tasks"
        );
      }
      const result = await taskRuns.start({
        launches,
        openTerminal: async (launch, runId) => {
          const panelId = backgroundPanelId(runId, launch.taskId);
          const processKey = panelRefKey(panelId, windowId);
          const environment = await processEnvironment.resolve({
            cwd: launch.cwd,
            source: "task",
            ...(clientEnv ? { clientEnv } : {}),
            ...(launch.env ? { explicitEnv: launch.env } : {}),
          });
          setBackgroundRun(launch.projectRootPath, launch.taskId, {
            label: launch.label,
            projectRootPath: launch.projectRootPath,
            runId,
            startedAt: now(),
            status: "running",
            taskId: launch.taskId,
            updatedAt: now(),
            ...(windowId ? { windowId } : {}),
          });
          backgroundProcesses.set(processKey, {
            panelId,
            projectRootPath: launch.projectRootPath,
            runId,
            taskId: launch.taskId,
            ...(windowId ? { windowId } : {}),
          });
          const spawnTimer = setTimeout(() => {
            backgroundSpawnTimers.delete(processKey);
            const processRecord = backgroundProcesses.get(processKey);
            if (
              disposed ||
              cancelledBackgroundProcessKeys.delete(processKey) ||
              !processRecord
            ) {
              backgroundProcesses.delete(processKey);
              return;
            }
            let completedSynchronously = false;
            const process = spawnBackgroundTaskOption({
              command: launch.rawCommand,
              cwd: launch.cwd,
              env: environment.env,
              onError: (error) => {
                completedSynchronously = true;
                console.error("[tasks] background task spawn failed:", error);
                finishBackgroundPanel(panelId, 1, windowId).catch(
                  (err: unknown) => {
                    console.error(
                      "[tasks] background task error handling failed:",
                      err
                    );
                  }
                );
              },
              onExit: (exitCode) => {
                completedSynchronously = true;
                finishBackgroundPanel(panelId, exitCode ?? 1, windowId).catch(
                  (err: unknown) => {
                    console.error(
                      "[tasks] background task completion failed:",
                      err
                    );
                  }
                );
              },
            });
            if (!completedSynchronously) {
              backgroundProcesses.set(processKey, {
                ...processRecord,
                process,
              });
            }
          }, 0);
          backgroundSpawnTimers.set(processKey, spawnTimer);
          recent
            .recordLaunch(launch)
            .then(() => {
              invalidateCollectCache(launch.projectRootPath);
            })
            .catch((err: unknown) => {
              console.error("[tasks] record background launch failed:", err);
            });
          return {
            panelId,
            ...(windowId ? { windowId } : {}),
          };
        },
        projectRootPath,
        rootTaskId,
      });
      recordCoordinatorRun({
        projectRootPath,
        rootTaskId,
        runId: result.runId,
      });
      return result;
    },
    async startRun({ launches, openTerminal, projectRootPath, rootTaskId }) {
      const result = await taskRuns.start({
        launches,
        openTerminal: async (launch, runId) => {
          const opened = await openTerminal(launch, runId);
          recordStartedRun({
            panelId: opened.panelId,
            projectRootPath: launch.projectRootPath,
            taskId: launch.taskId,
            windowId: opened.windowId,
          });
          await recent.recordLaunch(launch);
          invalidateCollectCache(launch.projectRootPath);
          onTaskActivity?.onLaunched(opened.panelId, opened.windowId, {
            taskId: launch.taskId,
            label: launch.label,
          });
          return opened;
        },
        projectRootPath,
        rootTaskId,
      });
      recordCoordinatorRun({
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
