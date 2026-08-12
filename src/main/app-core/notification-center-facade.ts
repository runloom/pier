/**
 * W5：control.snapshot / CLI 用的 FA 与 NCS 生产门面。
 * 从 app-core/index 抽出以控制入口文件行数。
 */
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import { peekNotificationCenterService } from "../ipc/notification-center.ts";
import type { NotificationCenterCommandFacade } from "./commands/notifications.ts";

export function createForegroundActivityFacade(): {
  snapshot: () => ReturnType<typeof foregroundActivityService.snapshot>;
} {
  return {
    snapshot: () => foregroundActivityService.snapshot(),
  };
}

export function createNotificationCenterCommandFacade(): NotificationCenterCommandFacade {
  return {
    markAllRead: () => {
      peekNotificationCenterService()?.markAllRead();
    },
    markRead: (id: string) => {
      peekNotificationCenterService()?.markRead(id);
    },
    snapshot: () => {
      const ncs = peekNotificationCenterService();
      if (!ncs) {
        return {
          items: [],
          seq: 0,
          unreadCount: 0,
          dndEnabled: false,
        };
      }
      return ncs.snapshot();
    },
  };
}
