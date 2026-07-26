import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeLiveModulesCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  if (!services.liveModules) {
    return null;
  }
  const liveModules = services.liveModules;
  try {
    switch (command.type) {
      case "liveModules.registerRoot": {
        // Refcounted retain so panel close can release without wiping other panels.
        const rootId = liveModules.retainRoot(command.spec);
        return success(requestId, { rootId });
      }
      case "liveModules.unregisterRoot": {
        liveModules.releaseRoot(command.rootId);
        return success(requestId, { rootId: command.rootId });
      }
      case "liveModules.compile": {
        const result = await liveModules.compile(
          command.rootId,
          command.relPath
        );
        return success(requestId, result);
      }
      case "liveModules.getUrl": {
        const url = liveModules.getUrl(command.rootId, command.moduleId);
        return success(requestId, { url });
      }
      default:
        return null;
    }
  } catch (error) {
    return failure(
      requestId,
      "internal_error",
      error instanceof Error ? error.message : String(error)
    );
  }
}
