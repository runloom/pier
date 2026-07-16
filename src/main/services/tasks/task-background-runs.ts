import type {
  TaskLaunchPlan,
  TaskOutputUpdate,
  TaskRunSnapshot,
} from "@shared/contracts/tasks.ts";
import { TASK_STOP_GRACE_MS } from "@shared/contracts/tasks.ts";
import {
  forgetBackgroundTaskProcess,
  rememberBackgroundTaskProcess,
} from "../../state/background-task-process-ledger.ts";
import type { ProcessEnvironmentService } from "../process-environment-service.ts";
import { backgroundPanelId, panelRefKey } from "./task-background-panel-id.ts";
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
 * 后台任务运行域：无终端面板的任务进程 spawn / 生命周期 / 输出缓冲。
 * 活体状态只写 TaskRuns；本模块不维护第二份 status 镜像。
 */
export function createTaskBackgroundRuns(
  options: CreateTaskBackgroundRunsOptions
): TaskBackgroundRuns {
  const { now } = options;
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

  function forgetProcess(runId: string): void {
    forgetBackgroundTaskProcess(runId).catch((error: unknown) => {
      console.error("[tasks] forget background process ledger failed:", error);
    });
  }

  function rememberProcess(
    runId: string,
    process: BackgroundTaskProcess,
    command: string
  ): void {
    if (typeof process.pid !== "number" || process.pid <= 0) {
      return;
    }
    rememberBackgroundTaskProcess({
      command,
      pid: process.pid,
      runId,
      startedAt: now(),
    }).catch((error: unknown) => {
      console.error(
        "[tasks] remember background process ledger failed:",
        error
      );
    });
  }

  async function finishPanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined
  ): Promise<TaskRunSnapshot | null> {
    const processKey = panelRefKey(panelId, windowId);
    const processRecord = processes.get(processKey);
    if (processRecord) {
      forgetProcess(processRecord.runId);
    }
    processes.delete(processKey);
    try {
      const result = await options.completePanel(panelId, exitCode, windowId);
      if (!result) {
        return null;
      }
      if (isTerminalRunStatus(result.status)) {
        options.onRunTerminal(result);
      }
      return result;
    } catch (err) {
      console.error("[tasks] background task completion failed:", err);
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
      forgetProcess(processRecord.runId);
      // Quit/dispose：先 TERM 再由 shutdownForQuit 升级；单次 cancel 仍发 TERM。
      signalBackgroundTaskProcess(processRecord.process, false);
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
    forgetProcess(processRecord.runId);
    outputs.flush(processRecord.runId, processRecord.outputTaskId);
    finishPanel(panelId, 137, windowId).catch((error: unknown) => {
      console.error("[tasks] background force stop completion failed:", error);
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
        rememberProcess(processRecord.runId, process, launch.rawCommand);
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

  async function shutdownForQuit(graceMs = TASK_STOP_GRACE_MS): Promise<void> {
    for (const spawnTimer of spawnTimers.values()) {
      clearTimeout(spawnTimer);
    }
    spawnTimers.clear();

    const live = [...processes.values()];
    for (const record of live) {
      signalBackgroundTaskProcess(record.process, false);
    }
    if (live.length > 0 && graceMs > 0) {
      const deadline = now() + graceMs;
      while (processes.size > 0 && now() < deadline) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });
      }
    }
    for (const record of [...processes.values()]) {
      signalBackgroundTaskProcess(record.process, true);
      forgetProcess(record.runId);
      processes.delete(panelRefKey(record.panelId, record.windowId));
      options.markPanelClosed(record.panelId, record.windowId);
      options.forgetRunningPanel(record.panelId, record.windowId);
    }
    cancelledProcessKeys.clear();
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
    for (const record of [...processes.values()]) {
      signalBackgroundTaskProcess(record.process, true);
      forgetProcess(record.runId);
    }
    processes.clear();
    cancelledProcessKeys.clear();
    outputs.dispose();
  }

  return {
    cancelPanel,
    dispose,
    finishPanel,
    forceStopPanel,
    output: (runId, taskId) => outputs.snapshot(runId, taskId),
    shutdownForQuit,
    start,
    stopPanel,
  };
}
