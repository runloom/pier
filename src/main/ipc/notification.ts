import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import type { IpcMain } from "electron";
import { focusAgentFromNotificationClick } from "../services/agent-attention/notification-click-focus.ts";
import { showSystemNotification } from "../services/system-notification.ts";

export interface NotificationIpcDeps {
  index?: AgentRuntimeIndexService;
}

/**
 * 系统通知 IPC。Attention 与 renderer 共用 `showSystemNotification`；
 * click → 唯一 `focusAgentFromNotificationClick`。
 */
export function registerNotificationIpc(
  ipcMain: IpcMain,
  deps: NotificationIpcDeps = {}
): void {
  ipcMain.handle(
    "pier:notification:system",
    async (
      _event,
      request: SystemNotificationRequest
    ): Promise<SystemNotificationResult> =>
      showSystemNotification(request, {
        onClick: async (shown) => {
          if (!deps.index) {
            return;
          }
          await focusAgentFromNotificationClick(deps.index, shown);
        },
      })
  );
}

export function bindNotificationFocus(
  index: AgentRuntimeIndexService
): NotificationIpcDeps {
  return { index };
}
