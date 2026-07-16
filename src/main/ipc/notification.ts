import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type {
  SystemNotificationPermissionSnapshot,
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { app, type IpcMain } from "electron";
import { broadcastSystemNotificationPermissionChanged } from "../app-core/window-broadcasts.ts";
import { focusAgentFromNotificationClick } from "../services/agent-attention/notification-click-focus.ts";
import {
  getSystemNotificationPermissionSnapshot,
  openSystemNotificationSettings,
  showSystemNotification,
  showTestSystemNotification,
} from "../services/system-notification.ts";
import { windowManager } from "../windows/window-manager.ts";

export interface NotificationIpcDeps {
  index?: AgentRuntimeIndexService;
}

function onPermissionChanged(
  snapshot: SystemNotificationPermissionSnapshot
): void {
  broadcastSystemNotificationPermissionChanged(snapshot);
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
        onPermissionChanged,
      })
  );

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_PERMISSION, () =>
    getSystemNotificationPermissionSnapshot()
  );

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_TEST, () =>
    showTestSystemNotification({
      onClick: () => {
        // 测试通知：激活任一 Pier 窗口，不 focus 业务 agent。
        const target =
          windowManager.getFocused() ?? windowManager.getAll()[0] ?? null;
        if (!target || target.isDestroyed()) {
          return;
        }
        if (target.isMinimized()) {
          target.restore();
        }
        if (process.platform === "darwin") {
          app.focus({ steal: true });
        }
        target.focus();
      },
      onPermissionChanged,
    })
  );

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_OPEN_SETTINGS, () =>
    openSystemNotificationSettings()
  );
}

export function bindNotificationFocus(
  index: AgentRuntimeIndexService
): NotificationIpcDeps {
  return { index };
}
