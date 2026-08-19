import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandFailure, commandSuccess } from "../command-results.ts";
import { asRecord } from "../command-value.ts";
import { listPanels, type PanelCommandServices } from "./panel.ts";

async function executeOnResolvedWindow(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.setSize" | "panel.equalize" }>,
  services: PanelCommandServices,
  panelIds: readonly string[]
): Promise<PierCommandResult> {
  if (command.windowId) {
    const result = await services.rendererCommand.execute(command);
    if (result.ok) {
      return commandSuccess(requestId, result.data);
    }
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }

  const snapshot = await listPanels({ type: "panel.list" }, services);
  if (snapshot.errors.length > 0) {
    return commandFailure(
      requestId,
      "platform_unavailable",
      "panel list incomplete; pass --window"
    );
  }
  const windowIds = new Set<string>();
  for (const panelId of panelIds) {
    const matches = snapshot.panels.filter((panel) => panel.id === panelId);
    if (matches.length === 0) {
      return commandFailure(
        requestId,
        "not_found",
        `panel not found: ${panelId}`
      );
    }
    if (matches.length > 1) {
      return commandFailure(
        requestId,
        "invalid_command",
        `panel id is ambiguous: ${panelId}; pass --window`
      );
    }
    const match = matches[0];
    if (!match) {
      return commandFailure(
        requestId,
        "not_found",
        `panel not found: ${panelId}`
      );
    }
    windowIds.add(match.windowId);
  }
  if (windowIds.size !== 1) {
    return commandFailure(
      requestId,
      "invalid_command",
      "panels are not in the same window"
    );
  }
  const windowId = [...windowIds][0];
  if (!windowId) {
    return commandFailure(requestId, "not_found", "panel not found");
  }
  const result = await services.rendererCommand.execute({
    ...command,
    windowId,
  });
  if (!result.ok) {
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  const record = asRecord(result.data);
  return commandSuccess(requestId, {
    ...(record ?? {}),
    windowId,
  });
}

export async function executePanelSetSizeCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.setSize" }>,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  return await executeOnResolvedWindow(requestId, command, services, [
    command.panelId,
  ]);
}

export async function executePanelEqualizeCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "panel.equalize" }>,
  services: PanelCommandServices
): Promise<PierCommandResult> {
  return await executeOnResolvedWindow(
    requestId,
    command,
    services,
    command.panelIds
  );
}
