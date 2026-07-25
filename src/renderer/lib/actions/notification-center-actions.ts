import i18next from "i18next";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";
import { useNotificationCenterPopoverStore } from "@/stores/notification-center-popover.store.ts";

async function runNotificationCenterCommand(
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("notificationsCenter.actionFailed"),
    });
  }
}

/** 消息中心命令：打开铃铛 Popover、切换勿扰、全部已读。 */
export const NOTIFICATION_CENTER_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "panel",
      group: "1_new",
      handler: () => {
        useNotificationCenterPopoverStore.getState().setOpen(true);
      },
      iconComponent: Bell,
      id: "pier.notifications.open",
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.openNotificationCenter",
    },
    {
      categoryKey: "panel",
      handler: async () => {
        const dndEnabled = useNotificationCenterStore.getState().dndEnabled;
        await runNotificationCenterCommand(() =>
          window.pier.notificationCenter.setDnd(!dndEnabled)
        );
      },
      iconComponent: BellOff,
      id: "pier.notifications.toggleDnd",
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.toggleNotificationDnd",
    },
    {
      categoryKey: "panel",
      handler: async () => {
        await runNotificationCenterCommand(() =>
          window.pier.notificationCenter.markAllRead()
        );
      },
      iconComponent: CheckCheck,
      id: "pier.notifications.markAllRead",
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.markAllNotificationsRead",
    },
  ];
