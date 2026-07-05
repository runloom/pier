import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeFileCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "file.list":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.list(command));
    case "file.readText":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.readText(command));
    case "file.writeText":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.writeText(command));
    case "file.move":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.move(command));
    case "file.trash":
      if (!services.files) {
        return failure(requestId, "internal_error", "file service unavailable");
      }
      return success(requestId, await services.files.trash(command));
    default:
      return null;
  }
}
