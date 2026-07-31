import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { useEffect } from "react";
import { showNotificationToast } from "@/lib/notifications/show-notification-toast.tsx";

/**
 * 形态 B 消息 toast 单投桥。
 * 只订阅 main → 本窗的 MESSAGE_TOAST；禁止从 NCS 快照订阅自弹（多窗会扇出）。
 */
export function NotificationMessageToastBridge(): null {
  useEffect(() => {
    const api = window.pier?.notificationCenter;
    if (!api?.onMessageToast) {
      return;
    }
    return api.onMessageToast((notification: AppNotification) => {
      showNotificationToast(notification);
    });
  }, []);
  return null;
}
