/**
 * terminal.close：关掉任意 terminal panel（含 agent）。
 * 复用 renderer `panel.close`；非 terminal 拒绝。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { requireTerminalPanel } from "./terminal-locate.ts";

type TerminalCloseCommand = Extract<PierCommand, { type: "terminal.close" }>;

export async function executeTerminalCloseCommand(
  requestId: string,
  command: TerminalCloseCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const found = await requireTerminalPanel(
    requestId,
    command.panelId,
    command.windowId,
    services
  );
  if (!found.ok) {
    return found.result;
  }
  const result = await services.rendererCommand.execute({
    panelId: found.panel.id,
    type: "panel.close",
    windowId: found.panel.windowId,
  });
  if (!result.ok) {
    return failure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  return success(requestId, {
    closed: true as const,
    panelId: found.panel.id,
    windowId: found.panel.windowId,
  });
}
