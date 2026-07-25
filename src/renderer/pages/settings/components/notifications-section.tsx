import type { SystemNotificationPermissionSnapshot } from "@shared/contracts/notification.ts";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { ContentCard } from "@/pages/settings/components/notifications/content-card.tsx";
import { DeliveryCard } from "@/pages/settings/components/notifications/delivery-card.tsx";
import { MessageCenterCard } from "@/pages/settings/components/notifications/message-center-card.tsx";

export { buildNotificationPolicyStatusItems } from "@/pages/settings/components/notifications/delivery-card.tsx";

function usePermissionSnapshot(): SystemNotificationPermissionSnapshot | null {
  const [snapshot, setSnapshot] =
    useState<SystemNotificationPermissionSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      window.pier.notifications
        .getPermissionStatus()
        .then((next) => {
          if (!cancelled) {
            setSnapshot(next);
          }
        })
        .catch(() => undefined);
    };

    refresh();
    const off = window.pier.notifications.onPermissionChanged((next) => {
      setSnapshot(next);
    });
    window.addEventListener("focus", refresh);

    return () => {
      cancelled = true;
      off();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return snapshot;
}

/**
 * 通知设置：消息中心（记录）→ 提醒内容（类别）→ 提醒方式（通道）。
 * 与消息生命周期同一漏斗；卡片实现拆在 ./notifications/ 下（文件行数硬顶）。
 */
export function NotificationsSection() {
  const t = useT();
  const snapshot = usePermissionSnapshot();

  return (
    <div className="flex flex-col gap-4 px-4 pb-4" id="notifications">
      <h1 className="text-xl">{t("settings.section.notifications")}</h1>
      <MessageCenterCard />
      <ContentCard />
      <DeliveryCard snapshot={snapshot} />
    </div>
  );
}
