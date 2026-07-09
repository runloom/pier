import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { LocalEnvironmentState } from "@shared/contracts/environment.ts";
import { isLocalEnvironmentScriptError } from "../services/local-environment-scripts.ts";
import { LocalEnvironmentServiceError } from "../services/local-environments-service.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeEnvironmentCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  onChanged?: (snapshot: LocalEnvironmentState) => void
): Promise<PierCommandResult | null> {
  try {
    switch (command.type) {
      case "environment.snapshot": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await services.localEnvironments.snapshot(request)
        );
      }
      case "environment.project.add": {
        const { type: _, ...request } = command;
        const state = await services.localEnvironments.addProject(request);
        onChanged?.(state);
        return success(requestId, state);
      }
      case "environment.project.remove": {
        const { type: _, ...request } = command;
        const state = await services.localEnvironments.removeProject(request);
        onChanged?.(state);
        return success(requestId, state);
      }
      case "environment.update": {
        const { type: _, ...request } = command;
        const state = await services.localEnvironments.updateProject(request);
        onChanged?.(state);
        return success(requestId, state);
      }
      case "environment.worktreeBinding": {
        const { type: _, ...request } = command;
        return success(
          requestId,
          await services.localEnvironments.worktreeBinding(request)
        );
      }
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof LocalEnvironmentServiceError) {
      return failure(requestId, "not_found", `${err.reason}: ${err.message}`);
    }
    if (isLocalEnvironmentScriptError(err)) {
      return failure(requestId, "environment_script_failed", err.message);
    }
    if (err instanceof Error) {
      return failure(requestId, "invalid_command", err.message);
    }
    throw err;
  }
}
