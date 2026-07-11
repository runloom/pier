import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  TaskLaunchPlan,
  TaskListResult,
  TaskPanelMetadata,
  TaskPanelRef,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";
import {
  executePanelFocusCommand,
  executeTerminalOpenCommand,
} from "./panel-commands.ts";

const TASK_ENV_PREWARM_LIMIT = 4;
const BACKGROUND_PANEL_ID_PREFIX = "background-task:";

class RunTerminalOpenError extends Error {
  readonly code: PierCommandErrorCode;

  constructor(code: PierCommandErrorCode, message: string) {
    super(message);
    this.name = "RunTerminalOpenError";
    this.code = code;
  }
}

type AlreadyRunningTaskPreparation = Extract<
  TaskSpawnPreparation,
  { status: "already-running" }
>;

function dataPanelId(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "panelId" in data &&
    typeof data.panelId === "string" &&
    data.panelId.length > 0
  ) {
    return data.panelId;
  }
  return null;
}

function dataWindowId(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "windowId" in data &&
    typeof data.windowId === "string" &&
    data.windowId.length > 0
  ) {
    return data.windowId;
  }
  return null;
}

function panelRefsFromSnapshot(snapshot: TaskRunSnapshot): TaskPanelRef[] {
  return Object.values(snapshot.nodes).flatMap((node) =>
    node.panelId && !node.panelId.startsWith(BACKGROUND_PANEL_ID_PREFIX)
      ? [{ panelId: node.panelId, windowId: node.windowId }]
      : []
  );
}

function taskPanelRefKey(ref: TaskPanelRef): string {
  return ref.windowId ? `${ref.windowId}\0${ref.panelId}` : ref.panelId;
}

function reusablePanelsForCommand(
  command: Extract<PierCommand, { type: "run.spawn" }>,
  preparation: Extract<TaskSpawnPreparation, { status: "ready" }>
): Record<string, TaskPanelRef> | undefined {
  const existing = Object.fromEntries(
    Object.entries(preparation.reusablePanels ?? {}).filter(
      ([, ref]) => !ref.panelId.startsWith(BACKGROUND_PANEL_ID_PREFIX)
    )
  );
  const existingOrEmpty =
    Object.keys(existing).length > 0 ? existing : undefined;
  const terminalPanelId = command.terminalPanelId;
  if (!terminalPanelId) {
    return existingOrEmpty;
  }
  const hasMatchingLaunch = preparation.launches.some(
    (launch) => launch.taskId === command.taskId
  );
  if (!hasMatchingLaunch) {
    return existingOrEmpty;
  }
  return {
    ...existing,
    [command.taskId]: {
      panelId: terminalPanelId,
      ...(command.windowId ? { windowId: command.windowId } : {}),
    },
  };
}

async function closePanelRefs(
  requestId: string,
  panelRefs: TaskPanelRef[],
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  for (const { panelId, windowId } of panelRefs) {
    if (!windowId) {
      return commandFailure(
        requestId,
        "internal_error",
        `task run panel missing window id: ${panelId}`
      );
    }
    const result = await services.rendererCommand.execute({
      panelId,
      type: "panel.close",
      windowId,
    });
    if (!result.ok) {
      return commandFailure(
        requestId,
        result.error.code ?? "platform_unavailable",
        result.error.message
      );
    }
  }
  return null;
}

async function closeRunPanels(
  requestId: string,
  snapshot: TaskRunSnapshot,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  return await closePanelRefs(
    requestId,
    panelRefsFromSnapshot(snapshot),
    services
  );
}

function terminalLaunchFor(plan: TaskLaunchPlan): {
  command: string;
  cwd: string;
  env?: Record<string, string>;
} {
  return {
    command: plan.command,
    cwd: plan.cwd,
    ...(plan.env ? { env: plan.env } : {}),
  };
}

function taskPanelMetadataFor(
  launch: TaskLaunchPlan,
  runId: string
): TaskPanelMetadata {
  return {
    cwd: launch.cwd,
    label: launch.label,
    projectRootPath: launch.projectRootPath,
    rawCommand: launch.rawCommand,
    runId,
    source: launch.source,
    startedAt: Date.now(),
    status: "running",
    taskId: launch.taskId,
  };
}

async function focusAlreadyRunningTask(
  requestId: string,
  command: Extract<PierCommand, { type: "run.spawn" }>,
  preparation: AlreadyRunningTaskPreparation,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  const focusResult = await executePanelFocusCommand(
    requestId,
    {
      focus: command.focus,
      panelId: preparation.panelId,
      type: "panel.focus",
      ...(preparation.windowId || command.windowId
        ? { windowId: preparation.windowId ?? command.windowId }
        : {}),
    },
    services
  );
  if (!focusResult.ok) {
    if (focusResult.error.code === "not_found") {
      services.tasks.markPanelClosed(preparation.panelId, preparation.windowId);
      return null;
    }
    return focusResult;
  }
  return commandSuccess(requestId, preparation);
}

async function closeOpenedPanelsAfterFailure(
  requestId: string,
  openedPanelRefs: TaskPanelRef[],
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  const closeFailure = await closePanelRefs(
    requestId,
    openedPanelRefs,
    services
  );
  if (closeFailure) {
    return closeFailure;
  }
  for (const { panelId, windowId } of openedPanelRefs) {
    services.tasks.markPanelClosed(panelId, windowId);
  }
  return null;
}
function prewarmTaskEnvironments(
  result: TaskListResult,
  services: PierCoreServices
): void {
  const cwds = new Set<string>();
  for (const task of result.tasks) {
    if (task.unsupportedReason) {
      continue;
    }
    cwds.add(task.cwd);
    if (cwds.size >= TASK_ENV_PREWARM_LIMIT) {
      break;
    }
  }
  for (const cwd of cwds) {
    services.processEnvironment
      .resolve({ cwd, source: "task" })
      .catch(() => undefined);
  }
}

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
  const preparation = await services.tasks.prepareSpawn({
    forceRestart: mode === "background" ? true : (command.forceRestart ?? true),
    inputs: command.inputs,
    projectRootPath: command.projectRootPath,
    taskId: command.taskId,
  });
  if (preparation.status === "requires-input") {
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
      services.tasks.cancelRun(preparation.restartRunId);
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
    return commandFailure(
      requestId,
      "internal_error",
      "task run did not start a terminal"
    );
  }

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
