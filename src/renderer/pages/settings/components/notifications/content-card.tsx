import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldLegend, FieldSet } from "@pier/ui/field.tsx";
import {
  TURN_NOTIFY_MODES,
  type TurnNotifyMode,
} from "@shared/contracts/agent/attention.ts";
import type { NotificationKind } from "@shared/contracts/notification-center.ts";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { patchAttention } from "@/pages/settings/components/attention-patch.ts";
import { GroupLegend } from "@/pages/settings/components/notifications/group-legend.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentAttentionPreferencesStore } from "@/stores/agent-attention-preferences.store.ts";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";

function mutedKindsWith(
  mutedKinds: readonly NotificationKind[],
  kind: NotificationKind,
  muted: boolean
): NotificationKind[] {
  if (muted) {
    return mutedKinds.includes(kind) ? [...mutedKinds] : [...mutedKinds, kind];
  }
  return mutedKinds.filter((candidate) => candidate !== kind);
}

/**
 * Card 2 · 提醒内容（类别：什么事找我）。
 * agent 组是「分类门闸」（关闭后事件不进消息中心）；
 * 任务与系统组只静音 toast（mutedKinds），记录照进。
 */
export function ContentCard(): ReactNode {
  const t = useT();
  const agentAttention = useAgentAttentionPreferencesStore(
    (s) => s.agentAttention
  );
  const setAgentAttention = useAgentAttentionPreferencesStore(
    (s) => s.setAgentAttention
  );
  const prefs = useNotificationCenterPrefsStore((s) => s.prefs);
  const setPrefs = useNotificationCenterPrefsStore((s) => s.setPrefs);
  const failedTitle = t("settings.notifications.saveFailed");

  const patchMutedKind = (kind: NotificationKind, muted: boolean) => {
    setPrefs((current) => ({
      ...current,
      mutedKinds: mutedKindsWith(current.mutedKinds, kind, muted),
    })).catch(() => {
      toast.error(failedTitle);
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <GroupLegend
          descKey="settings.notifications.contentDesc"
          titleKey="settings.notifications.contentTitle"
        />
        <FieldSet className="gap-4">
          <FieldLegend className="mb-0" variant="label">
            {t("settings.notifications.agentGroup")}
          </FieldLegend>
          <SwitchRow
            checked={agentAttention.enabled}
            description={t("settings.notifications.enabledDesc")}
            id="settings-attention-enabled"
            label={t("settings.notifications.enabled")}
            onCheckedChange={(checked) => {
              patchAttention(
                { enabled: checked },
                setAgentAttention,
                failedTitle
              ).catch(() => undefined);
            }}
          />
          <SwitchRow
            checked={agentAttention.enableErrorAttention}
            description={t("settings.notifications.errorDesc")}
            id="settings-attention-error"
            label={t("settings.notifications.error")}
            onCheckedChange={(checked) => {
              patchAttention(
                { enableErrorAttention: checked },
                setAgentAttention,
                failedTitle
              ).catch(() => undefined);
            }}
          />
          <SelectRow<TurnNotifyMode>
            description={t("settings.notifications.turnNotifyModeDesc")}
            id="settings-attention-turn-notify-mode"
            label={t("settings.notifications.turnNotifyMode")}
            onChange={(next) => {
              patchAttention(
                { turnNotifyMode: next },
                setAgentAttention,
                failedTitle
              ).catch(() => undefined);
            }}
            options={TURN_NOTIFY_MODES.map((mode) => ({
              label: t(`settings.notifications.turnNotifyModeOptions.${mode}`),
              value: mode,
            }))}
            triggerWidth="w-[200px]"
            value={agentAttention.turnNotifyMode}
          />
        </FieldSet>
        <FieldSet className="gap-4">
          <FieldLegend className="mb-0" variant="label">
            {t("settings.notifications.taskSystemGroup")}
          </FieldLegend>
          <SwitchRow
            checked={!prefs.mutedKinds.includes("app.update")}
            description={t("settings.notifications.appUpdateDesc")}
            id="settings-nc-app-update"
            label={t("settings.notifications.appUpdate")}
            onCheckedChange={(checked) => {
              patchMutedKind("app.update", !checked);
            }}
          />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
