import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  inspectAppCli,
  installAppCli,
  uninstallAppCli,
} from "../../services/app-cli/index.ts";
import { commandSuccess as success } from "../command-results.ts";

export async function executeAppCliCommand(
  requestId: string,
  command: PierCommand
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "app.cli.status":
      return success(requestId, inspectAppCli());
    case "app.cli.install":
      return success(
        requestId,
        await installAppCli({ allowAdmin: command.allowAdmin === true })
      );
    case "app.cli.uninstall":
      return success(
        requestId,
        await uninstallAppCli({ allowAdmin: command.allowAdmin === true })
      );
    default:
      return null;
  }
}
