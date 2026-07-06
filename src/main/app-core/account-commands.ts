import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeAccountCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "accounts.snapshot":
      return success(requestId, services.agentAccounts.snapshot());
    case "accounts.adoptCurrent":
      await services.agentAccounts.adoptCurrent();
      return success(requestId, undefined);
    case "accounts.add":
      await services.agentAccounts.add(command.provider);
      return success(requestId, undefined);
    case "accounts.cancelLogin":
      await services.agentAccounts.cancelLogin(command.provider);
      return success(requestId, undefined);
    case "accounts.select":
      await services.agentAccounts.select(command.accountId);
      return success(requestId, undefined);
    case "accounts.remove":
      await services.agentAccounts.remove(command.accountId);
      return success(requestId, undefined);
    case "accounts.refreshUsage":
      await services.agentAccounts.refreshUsage(true);
      return success(requestId, undefined);
    default:
      return null;
  }
}
