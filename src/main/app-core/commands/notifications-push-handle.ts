/**
 * Web Push 句柄命令面（M2，规格 §12）：getPushPublicKey / registerPushHandle /
 * unregisterPushHandle。仅 mobile-paired（metadata kind 门）；deviceId 一律取
 * 会话身份（`mobile:<deviceId>`），不信任何入参——防伪造他机句柄。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { CommandExecutionContext } from "../command-execution-context.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

const PUSH_HANDLE_COMMAND_TYPES = new Set([
  "notifications.getPushPublicKey",
  "notifications.registerPushHandle",
  "notifications.unregisterPushHandle",
]);

function sessionDeviceId(context: CommandExecutionContext): string | null {
  const clientId = context.clientId;
  if (!clientId?.startsWith("mobile:")) {
    return null;
  }
  const deviceId = clientId.slice("mobile:".length);
  return deviceId.length > 0 ? deviceId : null;
}

export async function executePushHandleCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  if (!PUSH_HANDLE_COMMAND_TYPES.has(command.type)) {
    return null;
  }
  const remotePush = services.remotePush;
  if (!remotePush) {
    return failure(
      requestId,
      "platform_unavailable",
      "remote push service not assembled"
    );
  }
  const deviceId = sessionDeviceId(context);
  if (deviceId === null) {
    return failure(
      requestId,
      "invalid_command",
      "push handle commands require a paired mobile session"
    );
  }

  switch (command.type) {
    case "notifications.getPushPublicKey": {
      await remotePush.ensureReady();
      const publicKey = remotePush.publicKey();
      if (publicKey === null) {
        return failure(
          requestId,
          "platform_unavailable",
          "vapid keys unavailable"
        );
      }
      return success(requestId, { publicKey });
    }
    case "notifications.registerPushHandle": {
      remotePush.registerHandle(deviceId, command.webPush);
      return success(requestId, { registered: true });
    }
    case "notifications.unregisterPushHandle": {
      remotePush.unregisterHandle(deviceId);
      return success(requestId, { registered: false });
    }
    default:
      return null;
  }
}
