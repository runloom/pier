import { resolveAttentionLocale } from "@main/services/agent-attention/attention-locale.ts";
import { runAttentionTestNotification } from "@main/services/agent-attention/attention-test-notification.ts";
import { maybePlayAfterShown } from "@main/services/agent-attention/notification-audio.ts";
import { getAgentAttentionSettingsCached } from "@main/services/agent-attention/settings-cache.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { formatAttentionTestNotificationCopy } from "@shared/agent-attention-copy.ts";
import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { app, type IpcMain } from "electron";
import {
  broadcastSystemNotificationPermissionChanged,
  sendAttentionSoundPlayToOneWindow,
} from "../app-core/window-broadcasts.ts";
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

/**
 * 系统通知 IPC。Attention 与 renderer 共用 `showSystemNotification`；
 * click → 唯一 `focusAgentFromNotificationClick`。
 */
export function registerNotificationIpc(
  ipcMain: IpcMain,
  deps: NotificationIpcDeps = {}
): void {
  ipcMain.handle(
    PIER.SYSTEM_NOTIFICATION_SHOW,
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
        onPermissionChanged: broadcastSystemNotificationPermissionChanged,
      })
  );

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_PERMISSION, () =>
    getSystemNotificationPermissionSnapshot()
  );

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_TEST, async () => {
    const locale = await resolveAttentionLocale();
    return runAttentionTestNotification({
      settings: getAgentAttentionSettingsCached(),
      showTest: (audio) =>
        showTestSystemNotification({
          copy: formatAttentionTestNotificationCopy(locale),
          silent: audio.silent,
          ...(audio.sound === undefined ? {} : { sound: audio.sound }),
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
          onPermissionChanged: broadcastSystemNotificationPermissionChanged,
        }),
      play: ({ decision, force }) => {
        maybePlayAfterShown({
          decision,
          force,
          sendToWindow: sendAttentionSoundPlayToOneWindow,
        });
      },
    });
  });

  ipcMain.handle(PIER.SYSTEM_NOTIFICATION_OPEN_SETTINGS, () =>
    openSystemNotificationSettings()
  );
}

export function bindNotificationFocus(
  index: AgentRuntimeIndexService
): NotificationIpcDeps {
  return { index };
}
