import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { AgentMcpCatalogServiceError } from "../../services/agent-mcp-catalog/service.ts";
import { AgentRulesServiceError } from "../../services/agent-rules/service.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export async function executeAgentAssetsCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  try {
    switch (command.type) {
      case "rules.snapshot": {
        if (!services.agentRules) return null;
        return success(
          requestId,
          await services.agentRules.snapshot(command.root)
        );
      }
      case "rules.read": {
        if (!services.agentRules) return null;
        return success(
          requestId,
          await services.agentRules.read(command.root, command.id)
        );
      }
      case "rules.write": {
        if (!services.agentRules) return null;
        return success(
          requestId,
          await services.agentRules.write(
            command.root,
            command.id,
            command.content
          )
        );
      }
      case "rules.ensure": {
        if (!services.agentRules) return null;
        return success(
          requestId,
          await services.agentRules.ensure(command.root, command.id)
        );
      }
      case "agentMcp.catalog": {
        if (!services.agentMcpCatalog) return null;
        return success(
          requestId,
          await services.agentMcpCatalog.catalog(command.root)
        );
      }
      case "agentMcp.reveal": {
        if (!services.agentMcpCatalog) return null;
        const result = await services.agentMcpCatalog.reveal(
          command.root,
          command.entryId
        );
        return success(requestId, { ok: true as const, ...result });
      }
      case "agentMcp.open": {
        if (!services.agentMcpCatalog) return null;
        const result = await services.agentMcpCatalog.open(
          command.root,
          command.entryId
        );
        return success(requestId, { ok: true as const, ...result });
      }
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof AgentRulesServiceError) {
      const code = err.reason === "not_found" ? "not_found" : "invalid_command";
      return failure(requestId, code, err.message);
    }
    if (err instanceof AgentMcpCatalogServiceError) {
      return failure(
        requestId,
        err.reason === "not_found" ? "not_found" : "invalid_command",
        err.message
      );
    }
    if (err instanceof Error) {
      return failure(requestId, "invalid_command", err.message);
    }
    throw err;
  }
}
