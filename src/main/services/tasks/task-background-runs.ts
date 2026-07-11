import type {
  TaskBackgroundRunSnapshot,
  TaskBackgroundSnapshot,
  TaskLaunchPlan,
  TaskOutputUpdate,
  TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentService } from "../process-environment-service.ts";
import {
  backgroundPanelId,
  isBackgroundPanelId,
  panelRefKey,
} from "./task-background-panel-id.ts";
import type {
  BackgroundTaskProcess,
  SpawnBackgroundTask,
} from "./task-background-runner.ts";
import { signalBackgroundTaskProcess } from "./task-background-runner.ts";
import type { TaskBackgroundRuns } from "./task-background-runs-contract.ts";
import { createTaskOutputBuffer } from "./task-output-buffer.ts";
import type { TaskRunCoordinatorStartResult } from "./task-run-coordinator.ts";
import { isTerminalRunStatus } from "./task-spawn-restart.ts";

export interface CreateTaskBackgroundRunsOptions {
  completePanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  forgetRunningPanel(panelId: string, windowId?: string | undefined): void;
  isDisposed(): boolean;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  now(): number;
  onRunTerminal(result: TaskRunSnapshot): void;
  onTaskOutputChanged?:
    | ((update: TaskOutputUpdate, windowId?: string) => void)
    | undefined;
  processEnvironment?: ProcessEnvironmentService | undefined;
  recordLaunch(launch: TaskLaunchPlan): void;
  spawnBackgroundTask: SpawnBackgroundTask;
  startRun(args: {
    launches: readonly TaskLaunchPlan[];
    mode?: "background" | "terminal-tab" | undefined;
    openTerminal(
      launch: TaskLaunchPlan,
      runId: string
    ): Promise<{ panelId: string; windowId?: string | undefined }>;
    projectRootPath: string;
    rootTaskId: string;
    ownerWindowId?: string | undefined;
    originPanelId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult>;
}

/**
 * 后台任务运行域：无终端面板的任务进程 spawn / 生命周期快照 / 取消清理。
 * 只依赖注入的 coordinator 回调，不 import task-service（单向依赖）。
 */
export function createTaskBackgroundRuns(
  options: CreateTaskBackgroundRunsOptions
): TaskBackgroundRuns {
  const { now } = options;
  const runsByProject = new Map<
    string,
    Map<string, TaskBackgroundRunSnapshot>
  >();
  const processes = new Map<
    string,
    {
      panelId: string;
      outputTaskId: string;
      process?: BackgroundTaskProcess | undefined;
      projectRootPath: string;
      runId: string;
      taskId: string;
      windowId?: string | undefined;
    }
  >();
  const spawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelledProcessKeys = new Set<string>();
  const outputs = createTaskOutputBuffer({
    now,
    ...(options.onTaskOutputChanged
      ? { onChanged: options.onTaskOutputChanged }
      : {}),
  });
  let version = 0;

  function snapshot(): TaskBackgroundSnapshot {
    return {
      runs: Object.fromEntries(
        [...runsByProject.entries()].map(([projectRootPath, runs]) => [
          projectRootPath,
          Object.fromEntries(runs.entries()),
        ])
      ),
      version,
    };
  }

  function publishSnapshot(): void {
    version += 1;
  }

  function setRun(
    projectRootPath: string,
    taskId: string,
    run: TaskBackgroundRunSnapshot
  ): void {
    const projectRuns =
      runsByProject.get(projectRootPath) ??
      new Map<string, TaskBackgroundRunSnapshot>();
    projectRuns.set(taskId, run);
    runsByProject.set(projectRootPath, projectRuns);
    publishSnapshot();
  }

  function updateRun(
    projectRootPath: string,
    taskId: string,
    patch: Partial<TaskBackgroundRunSnapshot>
  ): void {
    const current = runsByProject.get(projectRootPath)?.get(taskId);
    if (!current) {
      return;
    }
    setRun(projectRootPath, taskId, {
      ...current,
      ...patch,
      updatedAt: now(),
    });
  }

  function findRunPeer(
    projectRootPath: string,
    runId: string
  ): TaskBackgroundRunSnapshot | undefined {
    const projectRuns = runsByProject.get(projectRootPath);
    if (!projectRuns) {
      return;
    }
    return [...projectRuns.values()].find((run) => run.runId === runId);
  }

  function setNodeFromSnapshot(
    projectRootPath: string,
    runId: string,
    node: TaskRunSnapshot["nodes"][string]
  ): void {
    const current = runsByProject.get(projectRootPath)?.get(node.taskId);
    const peer = current ?? findRunPeer(projectRootPath, runId);
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
    setRun(projectRootPath, node.taskId, {
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

  async function finishPanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null> {
    const processKey = panelRefKey(panelId, windowId);
    const processRecord = processes.get(processKey);
    processes.delete(processKey);
    try {
      const result = await options.completePanel(panelId, exitCode, windowId);
      if (!result) {
        return null;
      }
      for (const node of Object.values(result.nodes)) {
        setNodeFromSnapshot(result.projectRootPath, result.runId, node);
      }
      if (isTerminalRunStatus(result.status)) {
        options.onRunTerminal(result);
      }
      return result;
    } catch (err) {
      console.error("[tasks] background task completion failed:", err);
      if (processRecord) {
        updateRun(processRecord.projectRootPath, processRecord.taskId, {
          exitCode,
          finishedAt: now(),
          status: exitCode === 0 ? "succeeded" : "failed",
        });
      }
      return null;
    }
  }

  function cancelPanel(panelId: string, windowId?: string | undefined): void {
    const processKey = panelRefKey(panelId, windowId);
    const spawnTimer = spawnTimers.get(processKey);
    if (spawnTimer) {
      clearTimeout(spawnTimer);
      spawnTimers.delete(processKey);
    }
    const processRecord = processes.get(processKey);
    processes.delete(processKey);
    cancelledProcessKeys.add(processKey);
    if (processRecord) {
      processRecord.process?.kill();
      updateRun(processRecord.projectRootPath, processRecord.taskId, {
        finishedAt: now(),
        status: "cancelled",
      });
    }
    options.markPanelClosed(panelId, windowId);
    options.forgetRunningPanel(panelId, windowId);
  }

  function stopPanel(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string; ok: boolean } {
    const processKey = panelRefKey(panelId, windowId);
    const spawnTimer = spawnTimers.get(processKey);
    if (spawnTimer) {
      clearTimeout(spawnTimer);
      spawnTimers.delete(processKey);
      finishPanel(panelId, 130, windowId).catch((error: unknown) => {
        console.error("[tasks] pending background stop failed:", error);
      });
      return { ok: true };
    }
    const processRecord = processes.get(processKey);
    if (!processRecord) {
      finishPanel(panelId, 130, windowId).catch((error: unknown) => {
        console.error("[tasks] background stop reconciliation failed:", error);
      });
      return { ok: true };
    }
    const accepted = signalBackgroundTaskProcess(processRecord.process, false);
    if (!accepted) {
      return { message: "background process rejected interrupt", ok: false };
    }
    updateRun(processRecord.projectRootPath, processRecord.taskId, {
      status: "stopping",
    });
    return { ok: true };
  }

  function forceStopPanel(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string; ok: boolean } {
    const processKey = panelRefKey(panelId, windowId);
    const spawnTimer = spawnTimers.get(processKey);
    if (spawnTimer) {
      clearTimeout(spawnTimer);
      spawnTimers.delete(processKey);
      finishPanel(panelId, 137, windowId).catch((error: unknown) => {
        console.error("[tasks] pending background force stop failed:", error);
      });
      return { ok: true };
    }
    const processRecord = processes.get(processKey);
    if (!processRecord) {
      finishPanel(panelId, 137, windowId).catch((error: unknown) => {
        console.error(
          "[tasks] background force stop reconciliation failed:",
          error
        );
      });
      return { ok: true };
    }
    const accepted = signalBackgroundTaskProcess(processRecord.process, true);
    if (!accepted) {
      return { message: "background process rejected force stop", ok: false };
    }
    outputs.flush(processRecord.runId, processRecord.outputTaskId);
    updateRun(processRecord.projectRootPath, processRecord.taskId, {
      finishedAt: now(),
      status: "cancelled",
    });
    return { ok: true };
  }

  function scheduleSpawn(args: {
    env: Record<string, string>;
    launch: TaskLaunchPlan;
    panelId: string;
    processKey: string;
    windowId?: string | undefined;
  }): void {
    const { env, launch, panelId, processKey, windowId } = args;
    const spawnTimer = setTimeout(() => {
      spawnTimers.delete(processKey);
      const processRecord = processes.get(processKey);
      if (
        options.isDisposed() ||
        cancelledProcessKeys.delete(processKey) ||
        !processRecord
      ) {
        processes.delete(processKey);
        return;
      }
      let completedSynchronously = false;
      const process = options.spawnBackgroundTask({
        command: launch.rawCommand,
        cwd: launch.cwd,
        env,
        onError: (error) => {
          completedSynchronously = true;
          outputs.append(
            processRecord.runId,
            processRecord.outputTaskId,
            "stderr",
            `${error.message}\n`
          );
          outputs.flush(processRecord.runId, processRecord.outputTaskId);
          console.error("[tasks] background task spawn failed:", error);
          finishPanel(panelId, 1, windowId).catch((err: unknown) => {
            console.error(
              "[tasks] background task error handling failed:",
              err
            );
          });
        },
        onExit: (exitCode) => {
          completedSynchronously = true;
          outputs.flush(processRecord.runId, processRecord.outputTaskId);
          finishPanel(panelId, exitCode ?? 1, windowId).catch(
            (err: unknown) => {
              console.error("[tasks] background task completion failed:", err);
            }
          );
        },
        onOutput: (stream, text) => {
          outputs.append(
            processRecord.runId,
            processRecord.outputTaskId,
            stream,
            text
          );
        },
      });
      if (!completedSynchronously) {
        processes.set(processKey, { ...processRecord, process });
      }
    }, 0);
    spawnTimers.set(processKey, spawnTimer);
  }

  async function start(args: {
    clientEnv?: Record<string, string> | undefined;
    launches: readonly TaskLaunchPlan[];
    originPanelId?: string | undefined;
    projectRootPath: string;
    rootTaskId: string;
    windowId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult> {
    const {
      clientEnv,
      launches,
      originPanelId,
      projectRootPath,
      rootTaskId,
      windowId,
    } = args;
    const { processEnvironment } = options;
    if (options.isDisposed()) {
      throw new Error("TaskService has been disposed");
    }
    if (!processEnvironment) {
      throw new Error(
        "TaskService requires processEnvironment for background tasks"
      );
    }
    return await options.startRun({
      launches,
      mode: "background",
      openTerminal: async (launch, runId) => {
        const panelId = backgroundPanelId(runId, launch.taskId);
        const processKey = panelRefKey(panelId, windowId);
        const environment = await processEnvironment.resolve({
          cwd: launch.cwd,
          source: "task",
          ...(clientEnv ? { clientEnv } : {}),
          ...(launch.env ? { explicitEnv: launch.env } : {}),
        });
        setRun(launch.projectRootPath, launch.taskId, {
          label: launch.label,
          projectRootPath: launch.projectRootPath,
          runId,
          startedAt: now(),
          status: "running",
          taskId: launch.taskId,
          updatedAt: now(),
          ...(windowId ? { windowId } : {}),
        });
        outputs.start({
          runId,
          taskId: rootTaskId,
          ...(windowId ? { windowId } : {}),
        });
        processes.set(processKey, {
          outputTaskId: rootTaskId,
          panelId,
          projectRootPath: launch.projectRootPath,
          runId,
          taskId: launch.taskId,
          ...(windowId ? { windowId } : {}),
        });
        scheduleSpawn({
          env: environment.env,
          launch,
          panelId,
          processKey,
          windowId,
        });
        options.recordLaunch(launch);
        return {
          panelId,
          ...(windowId ? { windowId } : {}),
        };
      },
      projectRootPath,
      rootTaskId,
      ownerWindowId: windowId,
      ...(originPanelId ? { originPanelId } : {}),
    });
  }

  function dispose(): void {
    for (const spawnTimer of spawnTimers.values()) {
      clearTimeout(spawnTimer);
    }
    spawnTimers.clear();
    const panelRefs = [...processes.values()].map((record) => ({
      panelId: record.panelId,
      windowId: record.windowId,
    }));
    for (const ref of panelRefs) {
      cancelPanel(ref.panelId, ref.windowId);
    }
    cancelledProcessKeys.clear();
    outputs.dispose();
  }

  return {
    cancelPanel,
    dispose,
    finishPanel,
    forceStopPanel,
    output: (runId, taskId) => outputs.snapshot(runId, taskId),
    setNodeFromSnapshot,
    snapshot,
    start,
    stopPanel,
  };
}
