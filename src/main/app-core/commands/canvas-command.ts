import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  CANVAS_COMMAND_CONFIRM_TIMEOUT_MS,
  invokeDeclaredCanvasCommand,
} from "../../services/canvas-command/invoke.ts";
import { isPathWithinRoot } from "../../services/live-modules/fence.ts";
import type { CommandExecutionContext } from "../command-execution-context.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export async function executeCanvasCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  if (command.type !== "canvasCommand.invoke") {
    return null;
  }
  if (!services.canvasTrust) {
    return failure(
      requestId,
      "platform_unavailable",
      "Canvas trust is unavailable"
    );
  }
  const windowId = context.runtimeWindowId;
  if (!windowId) {
    return failure(
      requestId,
      "invalid_command",
      "canvasCommand.invoke requires an originating window"
    );
  }
  const { canvasPath, key, projectRootPath } = command.payload;
  const outcome = await invokeDeclaredCanvasCommand({
    canvasPath,
    deps: {
      confirm: async (shellCommand, targetWindowId) => {
        const result = await services.rendererCommand.execute(
          {
            command: shellCommand,
            intent: "default",
            type: "dialog.confirm",
            windowId: targetWindowId,
          },
          {
            timeoutMs: CANVAS_COMMAND_CONFIRM_TIMEOUT_MS,
            windowId: targetWindowId,
          }
        );
        return result.ok === true && result.data === true;
      },
      isHomeRoot: async (root) => {
        const home = services.pierHome;
        if (!home) {
          return false;
        }
        if (await home.isHomeRoot(root)) {
          return true;
        }
        return isPathWithinRoot(root, home.rootPath());
      },
      spawn: async (input) => {
        const started = await services.tasks.startBackgroundRun({
          launches: input.launches,
          projectRootPath: input.projectRootPath,
          recordRecent: false,
          rootTaskId: input.rootTaskId,
          windowId: input.windowId,
        });
        return { runId: started.runId };
      },
      trust: services.canvasTrust,
    },
    key,
    projectRootPath,
    windowId,
  });
  if (outcome.kind === "error") {
    return failure(requestId, outcome.code, outcome.message);
  }
  return success(requestId, outcome);
}
