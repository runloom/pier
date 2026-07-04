import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeAiCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "ai.status":
      return success(requestId, await services.ai.status());
    case "ai.generateText":
      return success(
        requestId,
        await services.ai.generateText({
          prompt: command.prompt,
          projectRootPath: command.projectRootPath,
        })
      );
    default:
      return null;
  }
}
