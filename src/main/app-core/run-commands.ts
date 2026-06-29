import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  TaskLaunchPlan,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";
import {
  executePanelFocusCommand,
  executeTerminalOpenCommand,
} from "./panel-commands.ts";

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

interface TaskPanelRef {
  panelId: string;
  windowId?: string | undefined;
}

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
    node.panelId ? [{ panelId: node.panelId, windowId: node.windowId }] : []
  );
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

async function focusAlreadyRunningTask(
  requestId: string,
  command: Extract<PierCommand, { type: "run.spawn" }>,
  preparation: AlreadyRunningTaskPreparation,
  services: PierCoreServices
): Promise<PierCommandResult> {
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

export async function executeRunListCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.list" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  return commandSuccess(
    requestId,
    await services.tasks.list({ projectRoot: command.projectRoot })
  );
}

export async function executeRunSpawnCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.spawn" }>,
  services: PierCoreServices,
  options: { clientEnv?: Record<string, string> | undefined } = {}
): Promise<PierCommandResult> {
  const preparation = await services.tasks.prepareSpawn({
    inputs: command.inputs,
    projectRoot: command.projectRoot,
    taskId: command.taskId,
  });
  if (preparation.status === "requires-input") {
    return commandSuccess(requestId, preparation);
  }
  if (preparation.status === "unsupported") {
    return commandSuccess(requestId, preparation);
  }
  if (preparation.status === "already-running") {
    return await focusAlreadyRunningTask(
      requestId,
      command,
      preparation,
      services
    );
  }

  let started: Awaited<ReturnType<typeof services.tasks.startRun>>;
  const openedPanelRefs: TaskPanelRef[] = [];
  try {
    started = await services.tasks.startRun({
      launches: preparation.launches,
      openTerminal: async (launch) => {
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
          { clientEnv: options.clientEnv, source: "task", tab: launch.tab }
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
        openedPanelRefs.push({ panelId, windowId });
        return { panelId, windowId };
      },
      projectRoot: command.projectRoot,
      rootTaskId: command.taskId,
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
