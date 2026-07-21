import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSet } from "@pier/ui/field.tsx";
import {
  AGENT_ATTENTION_COOLDOWN_MS,
  type AgentAttentionCooldownMs,
  TURN_NOTIFY_MODES,
  type TurnNotifyMode,
} from "@shared/contracts/agent-attention.ts";
import type { SystemNotificationPermissionSnapshot } from "@shared/contracts/notification.ts";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { patchAttention } from "@/pages/settings/components/attention-patch.ts";
import { NotificationSoundBlock } from "@/pages/settings/components/notification-sound-block.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentAttentionPreferencesStore } from "@/stores/agent-attention-preferences.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

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

function PermissionBanner({
  snapshot,
}: {
  snapshot: SystemNotificationPermissionSnapshot | null;
}) {
  const t = useT();
  if (!snapshot || snapshot.status === "authorized") {
    return null;
  }

  if (snapshot.status === "unsupported") {
    return (
      <Alert variant="warning">
        <AlertTitle>
          {t("settings.notifications.permission.unsupportedTitle")}
        </AlertTitle>
        <AlertDescription>
          {t("settings.notifications.permission.unsupportedBody")}
        </AlertDescription>
      </Alert>
    );
  }

  if (snapshot.status === "denied") {
    return (
      <Alert variant="warning">
        <AlertTitle>
          {t("settings.notifications.permission.deniedTitle")}
        </AlertTitle>
        <AlertDescription>
          {t("settings.notifications.permission.deniedBody")}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="info">
      <AlertTitle>
        {t("settings.notifications.permission.unknownTitle")}
      </AlertTitle>
      <AlertDescription>
        {t("settings.notifications.permission.unknownBody")}
      </AlertDescription>
    </Alert>
  );
}

function PolicyCard({
  snapshot,
}: {
  snapshot: SystemNotificationPermissionSnapshot | null;
}) {
  const t = useT();
  const agentAttention = useAgentAttentionPreferencesStore(
    (s) => s.agentAttention
  );
  const setAgentAttention = useAgentAttentionPreferencesStore(
    (s) => s.setAgentAttention
  );
  const agentStatusHooks = useAgentPreferencesStore((s) => s.agentStatusHooks);
  const failedTitle = t("settings.notifications.saveFailed");
  const showPermission = snapshot !== null && snapshot.status !== "authorized";
  const showHooksOff = !agentStatusHooks;

  const cooldownOptions = AGENT_ATTENTION_COOLDOWN_MS.map((ms) => ({
    label: t(`settings.notifications.cooldown.${ms}`),
    value: String(ms),
  }));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {showPermission || showHooksOff ? (
          <div className="flex flex-col gap-3">
            {showPermission ? <PermissionBanner snapshot={snapshot} /> : null}
            {showHooksOff ? <StatusHooksHint /> : null}
          </div>
        ) : null}
        <FieldSet>
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
          <NotificationSoundBlock />
        </FieldSet>
      </CardContent>
    </Card>
  );
}

function DiagnosticsCard() {
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
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              runSendTest();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("settings.notifications.sendTest")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              openSystemSettings();
            }}
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
      </CardContent>
    </Card>
  );
}

function StatusHooksHint() {
  const t = useT();
  const agentStatusHooks = useAgentPreferencesStore((s) => s.agentStatusHooks);
  if (agentStatusHooks) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>{t("settings.notifications.hooksOffTitle")}</AlertTitle>
      <AlertDescription>
        {t("settings.notifications.hooksOffBody")}
      </AlertDescription>
    </Alert>
  );
}

/**
 * 通知设置：Attention 策略 + 系统通知通道健康。
 * 权限/hooks Alert 并入策略 Card 顶部（与插件页「Card 内 Alert」一致，避免卡套卡）。
 */
export function NotificationsSection() {
  const t = useT();
  const snapshot = usePermissionSnapshot();

  return (
    <div className="flex flex-col gap-4 px-4 pb-4" id="notifications">
      <h1 className="text-xl">{t("settings.section.notifications")}</h1>
      <PolicyCard snapshot={snapshot} />
      <DiagnosticsCard />
    </div>
  );
}
