import type {
  AppNotification,
  NotificationCenterSnapshot,
  NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Renderer 侧访问统一消息中心的 API。
 * 写入方是 main 端 NotificationCenterService；读取走 snapshot() 首拉 +
 * onChanged() 订阅（seq 单调守卫在镜像 store）。
 */
export interface PierNotificationCenterAPI {
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markReadByDedupeKey: (dedupeKey: string) => Promise<void>;
  onChanged: (cb: (snapshot: NotificationCenterSnapshot) => void) => () => void;
  report: (report: NotificationReport) => Promise<AppNotification | null>;
  setDnd: (enabled: boolean) => Promise<void>;
  snapshot: () => Promise<NotificationCenterSnapshot>;
}

export const notificationCenterApi: PierNotificationCenterAPI = {
  markAllRead: () => ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_MARK_ALL_READ),
  markRead: (id) => ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_MARK_READ, id),
  markReadByDedupeKey: (dedupeKey) =>
    ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_MARK_READ_BY_KEY, dedupeKey),
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: NotificationCenterSnapshot
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.NOTIFICATION_CENTER_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.NOTIFICATION_CENTER_CHANGED, listener);
    };
  },
  report: (report) =>
    ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_REPORT, report),
  setDnd: (enabled) =>
    ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_SET_DND, enabled),
  snapshot: () => ipcRenderer.invoke(PIER.NOTIFICATION_CENTER_SNAPSHOT),
};
