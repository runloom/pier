import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSet } from "@pier/ui/field.tsx";
import {
  StatusStack,
  type StatusStackItem,
  type StatusStackTone,
} from "@pier/ui/status-stack.tsx";
import {
  AGENT_ATTENTION_COOLDOWN_MS,
  type AgentAttentionCooldownMs,
} from "@shared/contracts/agent-attention.ts";
import type {
  SystemNotificationPermissionSnapshot,
  SystemNotificationPermissionStatus,
} from "@shared/contracts/notification.ts";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { patchAttention } from "@/pages/settings/components/attention-patch.ts";
import { NotificationSoundBlock } from "@/pages/settings/components/notification-sound-block.tsx";
import { GroupLegend } from "@/pages/settings/components/notifications/group-legend.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentAttentionPreferencesStore } from "@/stores/agent-attention-preferences.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";

function permissionStatusCopy(
  status: Exclude<SystemNotificationPermissionStatus, "authorized">,
  t: (key: string) => string
): { tone: StatusStackTone; title: string; description: string } {
  if (status === "unsupported") {
    return {
      tone: "warning",
      title: t("settings.notifications.permission.unsupportedTitle"),
      description: t("settings.notifications.permission.unsupportedBody"),
    };
  }
  if (status === "denied") {
    return {
      tone: "warning",
      title: t("settings.notifications.permission.deniedTitle"),
      description: t("settings.notifications.permission.deniedBody"),
    };
  }
  return {
    tone: "info",
    title: t("settings.notifications.permission.unknownTitle"),
    description: t("settings.notifications.permission.unknownBody"),
  };
}

/** 提醒方式卡顶部状态带：权限三态互斥，可与 hooks-off 并排。 */
export function buildNotificationPolicyStatusItems(input: {
  snapshot: SystemNotificationPermissionSnapshot | null;
  agentStatusHooks: boolean;
  t: (key: string) => string;
}): StatusStackItem[] {
  const { snapshot, agentStatusHooks, t } = input;
  const items: StatusStackItem[] = [];

  if (snapshot && snapshot.status !== "authorized") {
    const copy = permissionStatusCopy(snapshot.status, t);
    items.push({
      id: "notif-permission",
      tone: copy.tone,
      title: copy.title,
      description: copy.description,
    });
  }

  if (!agentStatusHooks) {
    items.push({
      id: "notif-hooks-off",
      tone: "info",
      title: t("settings.notifications.hooksOffTitle"),
      description: t("settings.notifications.hooksOffBody"),
    });
  }

  return items;
}

function SystemNotificationGroup(): ReactNode {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const runSendTest = () => {
    setBusy(true);
    window.pier.notifications
      .sendTest()
      .then((result) => {
        if (result.shown) {
          toast.success(t("settings.notifications.testSent"));
          return;
        }
        return showAppAlert({
          body: t("settings.notifications.testFailedDetail", {
            reason: result.reason ?? "failed",
          }),
          title: t("settings.notifications.testFailed"),
        });
      })
      .catch((err: unknown) =>
        showAppAlert({
          body: err instanceof Error ? err.message : String(err),
          title: t("settings.notifications.testFailed"),
        })
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const openSystemSettings = () => {
    setBusy(true);
    window.pier.notifications
      .openSystemSettings()
      .then((result) => {
        if (result.opened) {
          return;
        }
        return showAppAlert({
          body: t("settings.notifications.openSettingsManual"),
          title: t("settings.notifications.openSettingsFailed"),
        });
      })
      .catch((err: unknown) =>
        showAppAlert({
          body: err instanceof Error ? err.message : String(err),
          title: t("settings.notifications.openSettingsFailed"),
        })
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <FieldSet className="gap-4">
      <GroupLegend
        descKey="settings.notifications.systemGroupDesc"
        titleKey="settings.notifications.systemGroup"
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={runSendTest}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("settings.notifications.sendTest")}
          </Button>
          <Button
            disabled={busy}
            onClick={openSystemSettings}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("settings.notifications.openSystemSettings")}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {t("settings.notifications.testHint")}
        </p>
      </div>
    </FieldSet>
  );
}

/**
 * Card 3 · 提醒方式（通道：怎么打扰我）。
 * 权限/hooks 警示在卡内顶部 StatusStack（设置页 Alert 布局规范）；
 * 组序：系统通知 → 提示音 → 打扰控制（修饰符殿后）。
 */
export function DeliveryCard({
  snapshot,
}: {
  snapshot: SystemNotificationPermissionSnapshot | null;
}): ReactNode {
  const t = useT();
  const agentAttention = useAgentAttentionPreferencesStore(
    (s) => s.agentAttention
  );
  const setAgentAttention = useAgentAttentionPreferencesStore(
    (s) => s.setAgentAttention
  );
  const agentStatusHooks = useAgentPreferencesStore((s) => s.agentStatusHooks);
  const dndEnabled = useNotificationCenterStore((s) => s.dndEnabled);
  const failedTitle = t("settings.notifications.saveFailed");
  const items = buildNotificationPolicyStatusItems({
    snapshot,
    agentStatusHooks,
    t,
  });

  const cooldownOptions = AGENT_ATTENTION_COOLDOWN_MS.map((ms) => ({
    label: t(`settings.notifications.cooldown.${ms}`),
    value: String(ms),
  }));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <GroupLegend
          descKey="settings.notifications.deliveryDesc"
          titleKey="settings.notifications.deliveryTitle"
        />
        {items.length > 0 ? (
          <StatusStack
            data-testid="notifications-policy-status-stack"
            items={items}
          />
        ) : null}
        <SystemNotificationGroup />
        <NotificationSoundBlock />
        <FieldSet className="gap-4">
          <GroupLegend
            descKey="settings.notifications.disturbGroupDesc"
            titleKey="settings.notifications.disturbGroup"
          />
          <SwitchRow
            checked={dndEnabled}
            description={t("settings.notifications.dndDesc")}
            id="settings-nc-dnd"
            label={t("settings.notifications.dnd")}
            onCheckedChange={(checked) => {
              window.pier.notificationCenter.setDnd(checked).catch(() => {
                toast.error(failedTitle);
              });
            }}
          />
          <SwitchRow
            checked={agentAttention.suppressWhenFocused}
            description={t("settings.notifications.suppressDesc")}
            id="settings-attention-suppress"
            label={t("settings.notifications.suppress")}
            onCheckedChange={(checked) => {
              patchAttention(
                { suppressWhenFocused: checked },
                setAgentAttention,
                failedTitle
              ).catch(() => undefined);
            }}
          />
          <SelectRow<string>
            description={t("settings.notifications.cooldownDesc")}
            id="settings-attention-cooldown"
            label={t("settings.notifications.cooldownLabel")}
            onChange={(value) => {
              const cooldownMs = Number(value) as AgentAttentionCooldownMs;
              patchAttention(
                { cooldownMs },
                setAgentAttention,
                failedTitle
              ).catch(() => undefined);
            }}
            options={cooldownOptions}
            triggerWidth="w-[160px]"
            value={String(agentAttention.cooldownMs)}
          />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
