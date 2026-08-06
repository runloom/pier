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
import { commandFailure, commandSuccess } from "../command-results.ts";
import type { PierCoreServices } from "../command-router.ts";
import { executePanelFocusCommand } from "./panel.ts";

const TASK_ENV_PREWARM_LIMIT = 4;
export const BACKGROUND_PANEL_ID_PREFIX = "background-task:";

export class RunTerminalOpenError extends Error {
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

export function dataPanelId(data: unknown): string | null {
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

export function dataWindowId(data: unknown): string | null {
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

export function panelRefsFromSnapshot(
  snapshot: TaskRunSnapshot
): TaskPanelRef[] {
  return Object.values(snapshot.nodes).flatMap((node) =>
    node.panelId && !node.panelId.startsWith(BACKGROUND_PANEL_ID_PREFIX)
      ? [{ panelId: node.panelId, windowId: node.windowId }]
      : []
  );
}

export function taskPanelRefKey(ref: TaskPanelRef): string {
  return ref.windowId ? `${ref.windowId}\0${ref.panelId}` : ref.panelId;
}

export function reusablePanelsForCommand(
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

export async function closePanelRefs(
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

export async function closeRunPanels(
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

export function terminalLaunchFor(plan: TaskLaunchPlan): {
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

export function taskPanelMetadataFor(
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

export async function focusAlreadyRunningTask(
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

export async function closeOpenedPanelsAfterFailure(
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

export function prewarmTaskEnvironments(
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
