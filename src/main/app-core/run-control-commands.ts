import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";

export function executeRunBackgroundSnapshotCommand(
  requestId: string,
  services: PierCoreServices
): PierCommandResult {
  return commandSuccess(requestId, services.tasks.backgroundSnapshot());
}

export function executeRunRunsSnapshotCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.runsSnapshot" }>,
  services: PierCoreServices
): PierCommandResult {
  return commandSuccess(
    requestId,
    services.tasks.runsSnapshot(command.windowId)
  );
}

export function executeRunStopCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.stop" }>,
  services: PierCoreServices
): PierCommandResult {
  const result = services.tasks.stopRun(command.runId, command.force ?? false);
  if (!result) {
    return commandFailure(
      requestId,
      "not_found",
      `task run not found: ${command.runId}`
    );
  }
  return commandSuccess(requestId, result);
}
