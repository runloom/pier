import { useEffect } from "react";
import { initNotificationCenter } from "@/stores/notification-center.store.ts";
import { initNotificationCenterPrefs } from "@/stores/notification-center-prefs.store.ts";

/** 消息中心镜像水合桥 — 不渲染 UI（对齐 ForegroundActivityBridge）。 */
export function NotificationCenterBridge(): null {
  useEffect(() => {
    initNotificationCenterPrefs().catch(() => undefined);
    return initNotificationCenter();
  }, []);
  return null;
}
