import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { findWindowContext } from "../../windows/identity.ts";
import { windowManager } from "../../windows/manager.ts";
import { reportWindowDisplayDraft } from "../../windows/os-title.ts";
import type { CommandExecutionContext } from "../command-execution-context.ts";
import { commandFailure, commandSuccess } from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export async function executeWindowWorkspaceCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext = {}
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "window.close": {
      const closeResult = await services.window.close(command.windowId);
      switch (closeResult) {
        case "closed":
          return commandSuccess(requestId, null);
        case "not-found":
          return commandFailure(
            requestId,
            "not_found",
            `window not found: ${command.windowId}`
          );
        case "veto":
          return commandFailure(
            requestId,
            "internal_error",
            `window close was vetoed: ${command.windowId}`
          );
        default: {
          const _exhaustive: never = closeResult;
          return _exhaustive;
        }
      }
    }
    case "window.create":
      return commandSuccess(requestId, await services.window.create());
    case "window.focus":
      services.window.focus(command.windowId);
      return commandSuccess(requestId, null);
    case "window.list":
      return commandSuccess(requestId, services.window.list());
    case "window.reportDisplayDraft": {
      const windowId = context.runtimeWindowId;
      if (!windowId) {
        return commandFailure(requestId, "invalid_command", "missing window");
      }
      const window = windowManager.get(windowId);
      if (!window || window.isDestroyed()) {
        return commandFailure(
          requestId,
          "not_found",
          `window not found: ${windowId}`
        );
      }
      const recordId = findWindowContext(window)?.recordId ?? windowId;
      reportWindowDisplayDraft(windowId, recordId, {
        ...(command.baseLabel ? { baseLabel: command.baseLabel } : {}),
        ...(command.branch ? { branch: command.branch } : {}),
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
        ...(command.stableTabQualifier
          ? { stableTabQualifier: command.stableTabQualifier }
          : {}),
      });
      return commandSuccess(requestId, null);
    }
    case "workspace.layout.clear":
      await services.workspace.clearLayout(command.recordId);
      return commandSuccess(requestId, null);
    case "workspace.layout.read":
      return commandSuccess(
        requestId,
        await services.workspace.readLayout(command.recordId)
      );
    case "workspace.layout.save":
      await services.workspace.saveLayout(command.layout, command.recordId);
      return commandSuccess(requestId, null);
    default:
      return null;
  }
}
