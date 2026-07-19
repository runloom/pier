import type {
  TaskLaunchPlan,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import { deriveBackgroundSnapshot } from "@shared/contracts/tasks.ts";
import {
  isBackgroundPanelId,
  panelRefKey,
} from "./task-background-panel-id.ts";
import { spawnBackgroundTask } from "./task-background-runner.ts";
import { createTaskBackgroundRuns } from "./task-background-runs.ts";
import { createTaskCatalog } from "./task-catalog.ts";
import { requiredInputsForTask } from "./task-execution-plan.ts";
import { stopBackgroundRunsForOriginPanelClose } from "./task-origin-panel-close.ts";
import { createTaskPanelReuseRegistry } from "./task-panel-reuse-registry.ts";
import {
  createTaskRecentLauncher,
  type TaskRecentLauncher,
} from "./task-recent-launcher.ts";
import { createTaskRunCoordinator } from "./task-run-coordinator.ts";
import { createTaskRunStopper } from "./task-run-stopper.ts";
import type {
  CreateTaskServiceOptions,
  TaskService,
  TaskStartedRecord,
  TaskTerminalProcessController,
} from "./task-service-types.ts";
import {
  alreadyRunningPreparation as buildAlreadyRunningPreparation,
  buildReadyPreparation,
  restartPreparation as buildRestartPreparation,
  isTerminalRunStatus,
  type RestartPreparation,
  type RunningTaskInstance,
} from "./task-spawn-restart.ts";

export type {
  CreateTaskServiceOptions,
  TaskActivityCallbacks,
  TaskService,
  TaskSpawnRequest,
  TaskStartedRecord,
  TaskTerminalProcessController,
} from "./task-service-types.ts";

function runKey(projectRootPath: string, taskId: string): string {
  return `${projectRootPath}\0${taskId}`;
}

export function createTaskService({
  homeDir,
  now = () => Date.now(),
  onTaskOutputChanged,
  onTaskRunsChanged,
  onTaskActivity,
  processEnvironment,
  readRecentState,
  recentLimit,
  spawnBackgroundTask: spawnBackgroundTaskOption = spawnBackgroundTask,
  writeRecentState,
}: CreateTaskServiceOptions = {}): TaskService {
  const runningByKey = new Map<string, RunningTaskInstance>();
  const runningByPanel = new Map<string, Set<string>>();
  const outputListeners = new Set<
    NonNullable<CreateTaskServiceOptions["onTaskOutputChanged"]>
  >();
  const runListeners = new Set<
    NonNullable<CreateTaskServiceOptions["onTaskRunsChanged"]>
  >();
  const taskRuns = createTaskRunCoordinator({
    now,
    onChanged: (snapshot) => {
      onTaskRunsChanged?.(snapshot);
      for (const listener of runListeners) {
        listener(snapshot);
      }
    },
  });
  let terminalProcessController: TaskTerminalProcessController | null = null;
  let disposed = false;
  const recent: TaskRecentLauncher = createTaskRecentLauncher({
    now,
    ...(readRecentState ? { readRecentState } : {}),
    ...(recentLimit == null ? {} : { recentLimit }),
    ...(writeRecentState ? { writeRecentState } : {}),
  });

  const catalog = createTaskCatalog({ homeDir, now, recent });
  const collect = (projectRootPath: string) => catalog.list(projectRootPath);
  const invalidateCollectCache = (projectRootPath: string) => {
    catalog.invalidate(projectRootPath);
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

  function forgetSnapshotTasks(snapshot: TaskRunSnapshot): void {
    for (const node of Object.values(snapshot.nodes)) {
      runningByKey.delete(runKey(snapshot.projectRootPath, node.taskId));
    }
  }

  const backgroundRuns = createTaskBackgroundRuns({
    completePanel: (panelId, exitCode, windowId) =>
      taskRuns.completePanel(panelId, exitCode, windowId),
    forgetRunningPanel,
    isDisposed: () => disposed,
    markPanelClosed: (panelId, windowId) => {
      taskRuns.markPanelClosed(panelId, windowId);
    },
    now,
    onTaskOutputChanged: (update, windowId) => {
      onTaskOutputChanged?.(update, windowId);
      for (const listener of outputListeners) {
        listener(update, windowId);
      }
    },
    onRunTerminal: forgetSnapshotTasks,
    processEnvironment,
    recordLaunch: (launch) => {
      recent
        .recordLaunch(launch)
        .then(() => {
          invalidateCollectCache(launch.projectRootPath);
        })
        .catch((err: unknown) => {
          console.error("[tasks] record background launch failed:", err);
        });
    },
    spawnBackgroundTask: spawnBackgroundTaskOption,
    startRun: (args) => taskRuns.start(args),
  });
  const stopRun = createTaskRunStopper({
    backgroundRuns,
    forgetSnapshotTasks,
    getTerminalProcessController: () => terminalProcessController,
    now,
    taskRuns,
  });

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    backgroundRuns.dispose();
    outputListeners.clear();
    runListeners.clear();
  }

  async function shutdownForQuit(graceMs?: number): Promise<void> {
    if (disposed) {
      return;
    }
    await backgroundRuns.shutdownForQuit(graceMs);
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

  function alreadyRunningPreparation(
    projectRootPath: string,
    taskId: string
  ): TaskSpawnPreparation | null {
    const key = runKey(projectRootPath, taskId);
    return buildAlreadyRunningPreparation({
      deleteRunning: (runningKey) => {
        runningByKey.delete(runningKey);
      },
      isBackgroundPanel: isBackgroundPanelId,
      key,
      running: runningByKey.get(key),
      statusRun: (runId) => taskRuns.status(runId),
      taskId,
    });
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

  return {
    backgroundSnapshot: () => deriveBackgroundSnapshot(taskRuns.runsSnapshot()),
    bindTerminalProcessController(controller) {
      terminalProcessController = controller;
    },
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
          backgroundRuns.cancelPanel(node.panelId, node.windowId);
          continue;
        }
        forgetRunningPanel(node.panelId, node.windowId);
        if (node.status === "cancelled") {
          onTaskActivity?.onCleared(node.panelId, node.windowId, {
            runId: result.runId,
          });
        }
      }
      return result;
    },
    dispose,
    shutdownForQuit,
    async completePanel(panelId, exitCode, windowId, expectedRunId) {
      if (isBackgroundPanelId(panelId)) {
        return await backgroundRuns.finishPanel(panelId, exitCode, windowId);
      }
      const result = await taskRuns.completePanel(
        panelId,
        exitCode,
        windowId,
        expectedRunId
      );
      if (result) {
        markProcessFinished(panelId, windowId);
      }
      if (result && isTerminalRunStatus(result.status)) {
        forgetSnapshotTasks(result);
      }
      if (result) {
        onTaskActivity?.onCleared(panelId, windowId, {
          runId: result.runId,
        });
      }
      return result;
    },
    async list({ projectRootPath }) {
      return await collect(projectRootPath);
    },
    isStopRequested(panelId, windowId) {
      return taskRuns.isStopRequested(panelId, windowId);
    },
    markPanelClosed(panelId, windowId) {
      if (isBackgroundPanelId(panelId)) {
        backgroundRuns.cancelPanel(panelId, windowId);
        return;
      }
      stopBackgroundRunsForOriginPanelClose({
        backgroundRuns,
        forgetSnapshotTasks,
        panelId,
        taskRuns,
      });
      markPanelActuallyClosed(panelId, windowId);
    },
    moveRunningOwnerWindow(input) {
      taskRuns.moveRunningOwnerWindow(input);
    },
    output: (runId, taskId) => backgroundRuns.output(runId, taskId),
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
    runsSnapshot: (windowId) => taskRuns.runsSnapshot(windowId),
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
    async startBackgroundRun(args) {
      const result = await backgroundRuns.start(args);
      recordCoordinatorRun({
        projectRootPath: args.projectRootPath,
        rootTaskId: args.rootTaskId,
        runId: result.runId,
      });
      return result;
    },
    async startRun({
      launches,
      openTerminal,
      projectRootPath,
      rootTaskId,
      windowId,
    }) {
      const result = await taskRuns.start({
        launches,
        mode: "terminal-tab",
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
            runId,
          });
          return opened;
        },
        projectRootPath,
        rootTaskId,
        ...(windowId ? { ownerWindowId: windowId } : {}),
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
    stopRun,
    subscribeOutput(listener) {
      outputListeners.add(listener);
      return () => {
        outputListeners.delete(listener);
      };
    },
    subscribeRuns(listener) {
      runListeners.add(listener);
      return () => {
        runListeners.delete(listener);
      };
    },
  };
}
