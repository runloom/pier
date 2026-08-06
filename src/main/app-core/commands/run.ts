import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { TaskLaunchPlan, TaskPanelRef } from "@shared/contracts/tasks.ts";
import { createLogger } from "@shared/logger.ts";
import { commandFailure, commandSuccess } from "../command-results.ts";
import type { PierCoreServices } from "../command-router.ts";
import { executeTerminalOpenCommand } from "./panel.ts";
import {
  closeOpenedPanelsAfterFailure,
  closePanelRefs,
  closeRunPanels,
  dataPanelId,
  dataWindowId,
  focusAlreadyRunningTask,
  panelRefsFromSnapshot,
  prewarmTaskEnvironments,
  RunTerminalOpenError,
  reusablePanelsForCommand,
  taskPanelMetadataFor,
  taskPanelRefKey,
  terminalLaunchFor,
} from "./run-spawn-helpers.ts";

const log = createLogger("task.spawn");

export async function executeRunListCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.list" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const result = await services.tasks.list({
    projectRootPath: command.projectRootPath,
  });
  prewarmTaskEnvironments(result, services);
  return commandSuccess(requestId, result);
}

export async function executeRunSpawnCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.spawn" }>,
  services: PierCoreServices,
  options: { clientEnv?: Record<string, string> | undefined } = {}
): Promise<PierCommandResult> {
  const mode = command.mode ?? "terminal-tab";
  log.info("run.spawn begin", {
    mode,
    projectRootPath: command.projectRootPath,
    requestId,
    taskId: command.taskId,
    terminalPanelId: command.terminalPanelId,
    windowId: command.windowId,
  });
  const preparation = await services.tasks.prepareSpawn({
    forceRestart: mode === "background" ? true : (command.forceRestart ?? true),
    inputs: command.inputs,
    projectRootPath: command.projectRootPath,
    skipMissingDependencies: command.skipMissingDependencies ?? false,
    taskId: command.taskId,
  });
  if (
    preparation.status !== "ready" &&
    preparation.status !== "already-running"
  ) {
    log.info("run.spawn preparation non-ready", {
      requestId,
      status: preparation.status,
      taskId: command.taskId,
    });
  }
  if (preparation.status === "requires-input") {
    return commandSuccess(requestId, preparation);
  }
  if (preparation.status === "missing-dependencies") {
    return commandSuccess(requestId, preparation);
  }
  if (preparation.status === "unsupported") {
    return commandSuccess(requestId, preparation);
  }
  if (preparation.status === "already-running") {
    const focusResult = await focusAlreadyRunningTask(
      requestId,
      command,
      preparation,
      services
    );
    if (focusResult) {
      return focusResult;
    }
    return await executeRunSpawnCommand(requestId, command, services, options);
  }

  if (preparation.restartRunId) {
    const snapshot = services.tasks.statusRun(preparation.restartRunId);
    if (snapshot) {
      // 重新运行替换旧实例：标记 superseded，避免 UI 弹「任务已取消」。
      services.tasks.cancelRun(preparation.restartRunId, {
        termination: "superseded",
      });
      const reusablePanels =
        mode === "background"
          ? undefined
          : reusablePanelsForCommand(command, preparation);
      const reusablePanelKeys = new Set(
        Object.values(reusablePanels ?? {}).map(taskPanelRefKey)
      );
      const obsoletePanelRefs = panelRefsFromSnapshot(snapshot).filter(
        (ref) => !reusablePanelKeys.has(taskPanelRefKey(ref))
      );
      const closeFailure = await closePanelRefs(
        requestId,
        obsoletePanelRefs,
        services
      );
      if (closeFailure) {
        return closeFailure;
      }
    }
  }

  if (mode === "background") {
    const started = await services.tasks.startBackgroundRun({
      launches: preparation.launches,
      ...(command.terminalPanelId
        ? { originPanelId: command.terminalPanelId }
        : {}),
      projectRootPath: command.projectRootPath,
      rootTaskId: command.taskId,
      ...(options.clientEnv ? { clientEnv: options.clientEnv } : {}),
      ...(command.windowId ? { windowId: command.windowId } : {}),
    });
    const control = services.tasks.runsSnapshot(command.windowId).runs[
      started.runId
    ];
    log.info("run.spawn background started", {
      controlStatus: control?.status,
      originPanelId: control?.originPanelId,
      ownerWindowId: control?.ownerWindowId,
      requestId,
      runId: started.runId,
      taskId: command.taskId,
      terminalPanelId: command.terminalPanelId,
      windowId: command.windowId,
    });
    return commandSuccess(requestId, {
      panelIds: [],
      runId: started.runId,
      snapshot: started.snapshot,
      status: "started",
    });
  }

  let started: Awaited<ReturnType<typeof services.tasks.startRun>>;
  const openedPanelRefs: TaskPanelRef[] = [];
  const openTerminalForLaunch = async (
    launch: TaskLaunchPlan,
    runId: string,
    reusePanel?: TaskPanelRef | undefined
  ): Promise<TaskPanelRef> => {
    const task = taskPanelMetadataFor(launch, runId);
    const result = await executeTerminalOpenCommand(
      requestId,
      {
        focus: command.focus ?? launch.focus,
        launch: terminalLaunchFor(launch),
        placement: command.placement ?? "active-tab",
        type: "terminal.open",
        ...(command.windowId ? { windowId: command.windowId } : {}),
      },
      services,
      {
        clientEnv: options.clientEnv,
        ...(reusePanel ? { reusePanel } : {}),
        source: "task",
        tab: launch.tab,
        task,
        ...(command.targetGroupId
          ? { targetGroupId: command.targetGroupId }
          : {}),
      }
    );
    if (!result.ok) {
      throw new RunTerminalOpenError(
        result.error.code ?? "platform_unavailable",
        result.error.message
      );
    }
    const panelId = dataPanelId(result.data);
    if (!panelId) {
      throw new Error("terminal.open did not return a panel id");
    }
    const windowId = dataWindowId(result.data);
    if (!windowId) {
      throw new Error("terminal.open did not return a window id");
    }
    const opened = { panelId, windowId };
    openedPanelRefs.push(opened);
    return opened;
  };
  try {
    const reusablePanels = reusablePanelsForCommand(command, preparation);
    started = await services.tasks.startRun({
      launches: preparation.launches,
      openTerminal: async (launch, runId) => {
        const reusePanel = reusablePanels?.[launch.taskId];
        try {
          return await openTerminalForLaunch(launch, runId, reusePanel);
        } catch (error) {
          if (
            reusePanel &&
            error instanceof RunTerminalOpenError &&
            error.code === "not_found"
          ) {
            services.tasks.markPanelClosed(
              reusePanel.panelId,
              reusePanel.windowId
            );
            return await openTerminalForLaunch(launch, runId);
          }
          throw error;
        }
      },
      projectRootPath: command.projectRootPath,
      rootTaskId: command.taskId,
      ...(command.windowId ? { windowId: command.windowId } : {}),
    });
  } catch (error) {
    if (error instanceof RunTerminalOpenError) {
      const closeFailure = await closeOpenedPanelsAfterFailure(
        requestId,
        openedPanelRefs,
        services
      );
      if (closeFailure) {
        return closeFailure;
      }
      return commandFailure(requestId, error.code, error.message);
    }
    throw error;
  }

  if (!started.primaryPanelId) {
    log.warn("run.spawn terminal-tab missing primaryPanelId", {
      panelIds: started.panelIds,
      requestId,
      runId: started.runId,
      taskId: command.taskId,
    });
    return commandFailure(
      requestId,
      "internal_error",
      "task run did not start a terminal"
    );
  }

  log.info("run.spawn terminal-tab started", {
    panelIds: started.panelIds,
    primaryPanelId: started.primaryPanelId,
    requestId,
    runId: started.runId,
    taskId: command.taskId,
    windowId: command.windowId,
  });
  return commandSuccess(requestId, {
    panelIds: started.panelIds,
    primaryPanelId: started.primaryPanelId,
    runId: started.runId,
    snapshot: started.snapshot,
    status: "started",
  });
}

export function executeRunStatusCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.status" }>,
  services: PierCoreServices
): PierCommandResult {
  const snapshot = services.tasks.statusRun(command.runId);
  if (!snapshot) {
    return commandFailure(
      requestId,
      "not_found",
      `task run not found: ${command.runId}`
    );
  }
  return commandSuccess(requestId, snapshot);
}

export async function executeRunCancelCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.cancel" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const snapshot = services.tasks.statusRun(command.runId);
  if (!snapshot) {
    return commandFailure(
      requestId,
      "not_found",
      `task run not found: ${command.runId}`
    );
  }
  const closeFailure = await closeRunPanels(requestId, snapshot, services);
  if (closeFailure) {
    return closeFailure;
  }
  const cancelled = services.tasks.cancelRun(command.runId);
  return commandSuccess(requestId, cancelled ?? snapshot);
}

export function executeRunRecentCommand(
  requestId: string,
  services: PierCoreServices
): PierCommandResult {
  return commandSuccess(requestId, services.tasks.recentTasks());
}
