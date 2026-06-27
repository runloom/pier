import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";
import {
  executePanelFocusCommand,
  executeTerminalOpenCommand,
} from "./panel-commands.ts";

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
    await executePanelFocusCommand(
      requestId,
      {
        focus: command.focus,
        panelId: preparation.panelId,
        type: "panel.focus",
      },
      services
    );
    return commandSuccess(requestId, preparation);
  }

  const panelIds: string[] = [];
  for (const launch of preparation.launches) {
    const result = await executeTerminalOpenCommand(
      requestId,
      {
        focus: command.focus ?? launch.focus,
        launch: terminalLaunchFor(launch),
        placement: command.placement ?? "active-tab",
        type: "terminal.open",
      },
      services,
      { clientEnv: options.clientEnv, source: "task", tab: launch.tab }
    );
    if (!result.ok) {
      return result;
    }
    const panelId = dataPanelId(result.data);
    if (!panelId) {
      return commandFailure(
        requestId,
        "internal_error",
        "terminal.open did not return a panel id"
      );
    }
    services.tasks.recordStarted({
      panelId,
      projectRoot: launch.projectRoot,
      taskId: launch.taskId,
    });
    await services.tasks.recordRecent(launch);
    panelIds.push(panelId);
  }

  return commandSuccess(requestId, {
    panelIds,
    primaryPanelId: panelIds.at(-1) ?? panelIds[0],
    status: "started",
  });
}
