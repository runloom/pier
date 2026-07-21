import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PanelTransferCaller } from "../services/panel-transfer/panel-transfer-types.ts";
import type { CommandExecutionContext } from "./command-execution-context.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

function callerFromContext(
  context: CommandExecutionContext
): PanelTransferCaller | null {
  if (
    context.runtimeWindowId === undefined ||
    context.windowRecordId === undefined ||
    context.webContentsId === undefined ||
    context.navigationGeneration === undefined
  ) {
    return null;
  }
  return {
    navigationGeneration: context.navigationGeneration,
    runtimeWindowId: context.runtimeWindowId,
    webContentsId: context.webContentsId,
    windowRecordId: context.windowRecordId,
  };
}

export async function executePanelTransferCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  if (!command.type.startsWith("panelTransfer.")) {
    return null;
  }
  const panelTransfer = services.panelTransfer;
  if (!panelTransfer) {
    return commandFailure(
      requestId,
      "platform_unavailable",
      "panel transfer service unavailable"
    );
  }
  const caller = callerFromContext(context);
  if (!caller) {
    return commandFailure(
      requestId,
      "invalid_command",
      "panel transfer requires desktop renderer window identity"
    );
  }

  switch (command.type) {
    case "panelTransfer.offer":
      return commandSuccess(
        requestId,
        await panelTransfer.offer(caller, command.offer)
      );
    case "panelTransfer.drop":
      return commandSuccess(
        requestId,
        await panelTransfer.drop(caller, {
          placement: command.placement,
          transferId: command.transferId,
        })
      );
    case "panelTransfer.finishDrag":
      return commandSuccess(
        requestId,
        await panelTransfer.finishDrag(caller, command.transferId)
      );
    case "panelTransfer.cancel":
      await panelTransfer.cancel(caller, command.transferId);
      return commandSuccess(requestId, null);
    case "panelTransfer.bootstrap":
      return commandSuccess(requestId, await panelTransfer.bootstrap(caller));
    case "panelTransfer.ready":
      return commandSuccess(
        requestId,
        await panelTransfer.ready(caller, command.transferId)
      );
    default:
      return null;
  }
}
