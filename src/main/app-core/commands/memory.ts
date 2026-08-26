import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export async function executeMemoryCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  if (!services.projectMemory) {
    return null;
  }
  if (
    command.type !== "memory.enable" &&
    command.type !== "memory.disable" &&
    command.type !== "memory.status"
  ) {
    return null;
  }
  if (command.root.scope !== "project") {
    return failure(
      requestId,
      "invalid_command",
      "project memory requires a project root"
    );
  }
  const root = command.root;
  try {
    switch (command.type) {
      case "memory.enable":
        return success(requestId, await services.projectMemory.enable(root));
      case "memory.disable":
        return success(requestId, await services.projectMemory.disable(root));
      case "memory.status":
        return success(requestId, await services.projectMemory.status(root));
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof Error) {
      return failure(requestId, "invalid_command", err.message);
    }
    throw err;
  }
}
