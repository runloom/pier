import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSet } from "@pier/ui/field.tsx";
import type { NotificationRetentionDays } from "@shared/contracts/notification-center.ts";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { GroupLegend } from "@/pages/settings/components/notifications/group-legend.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";

/** Card 1 · 消息中心（记录底座：保留策略 + 未读徽标）。 */
export function MessageCenterCard(): ReactNode {
  const t = useT();
  const prefs = useNotificationCenterPrefsStore((s) => s.prefs);
  const setPrefs = useNotificationCenterPrefsStore((s) => s.setPrefs);
  const failedTitle = t("settings.notifications.saveFailed");

  const patchPrefs = (patch: Partial<typeof prefs>) => {
    setPrefs((current) => ({ ...current, ...patch })).catch(() => {
      toast.error(failedTitle);
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <GroupLegend
          descKey="settings.notifications.centerDesc"
          titleKey="settings.notifications.centerTitle"
        />
        <FieldSet>
          <SelectRow<string>
            description={t("settings.notifications.retentionDesc")}
            id="settings-nc-retention"
            label={t("settings.notifications.retention")}
            onChange={(value) => {
              patchPrefs({
                retentionDays: Number(value) as NotificationRetentionDays,
              });
            }}
            options={["7", "30"].map((days) => ({
              label: t(`settings.notifications.retentionOptions.${days}`),
              value: days,
            }))}
            triggerWidth="w-[160px]"
            value={String(prefs.retentionDays)}
          />
          <SwitchRow
            checked={prefs.showUnreadBadge}
            description={t("settings.notifications.showBadgeDesc")}
            id="settings-nc-show-badge"
            label={t("settings.notifications.showBadge")}
            onCheckedChange={(checked) => {
              patchPrefs({ showUnreadBadge: checked });
            }}
          />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
