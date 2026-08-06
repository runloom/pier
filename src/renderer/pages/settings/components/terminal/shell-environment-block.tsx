import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import {
  FieldDescription,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@pier/ui/field.tsx";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useShellEnvironmentStore } from "@/stores/shell-environment.store.ts";

function statusLabelKey(
  status: string | undefined
):
  | "settings.shellEnvironment.status.resolved"
  | "settings.shellEnvironment.status.failed"
  | "settings.shellEnvironment.status.skipped"
  | "settings.shellEnvironment.status.unknown" {
  if (status === "resolved" || status === "cached") {
    return "settings.shellEnvironment.status.resolved";
  }
  if (status === "failed") {
    return "settings.shellEnvironment.status.failed";
  }
  if (status === "skipped") {
    return "settings.shellEnvironment.status.skipped";
  }
  return "settings.shellEnvironment.status.unknown";
}

/**
 * 设置页只展示用户能行动的信息：是否对齐终端、失败/跳过原因、重载与开关。
 * dumpMode / 耗时 / PATH 差分 等实现诊断留在 main 日志与 NCS，不进前台。
 */
export function ShellEnvironmentBlock() {
  const t = useT();
  const disabled = useShellEnvironmentStore((s) => s.disabled);
  const timeoutMs = useShellEnvironmentStore((s) => s.timeoutMs);
  const hostStatus = useShellEnvironmentStore((s) => s.hostStatus);
  const loading = useShellEnvironmentStore((s) => s.loading);
  const setDisabled = useShellEnvironmentStore((s) => s.setDisabled);
  const setTimeoutMs = useShellEnvironmentStore((s) => s.setTimeoutMs);
  const refreshHostStatus = useShellEnvironmentStore(
    (s) => s.refreshHostStatus
  );
  const loadHostStatus = useShellEnvironmentStore((s) => s.loadHostStatus);

  const [timeoutDraft, setTimeoutDraft] = useState(String(timeoutMs / 1000));
  const [prevTimeout, setPrevTimeout] = useState(timeoutMs);
  if (timeoutMs !== prevTimeout) {
    setPrevTimeout(timeoutMs);
    setTimeoutDraft(String(timeoutMs / 1000));
  }

  useEffect(() => {
    loadHostStatus().catch(() => undefined);
  }, [loadHostStatus]);

  const isWindows = hostStatus?.platform === "win32";
  const statusText = t(statusLabelKey(hostStatus?.shellEnvStatus));
  const skipReasonKey =
    hostStatus?.skipReason === "cli" ||
    hostStatus?.skipReason === "disabled" ||
    hostStatus?.skipReason === "no-shell" ||
    hostStatus?.skipReason === "windows"
      ? (`settings.shellEnvironment.skipReason.${hostStatus.skipReason}` as const)
      : null;
  const showFailureDetail =
    hostStatus?.shellEnvStatus === "failed" && Boolean(hostStatus.error);
  const showSkipReason =
    hostStatus?.shellEnvStatus === "skipped" && skipReasonKey !== null;

  return (
    <Card>
      <CardContent>
        <FieldSet>
          <FieldLegend>{t("settings.shellEnvironment.title")}</FieldLegend>
          <FieldDescription>
            {t("settings.shellEnvironment.description")}
          </FieldDescription>
          {isWindows ? (
            <FieldDescription>
              {t("settings.shellEnvironment.windowsNote")}
            </FieldDescription>
          ) : null}
          <FieldSeparator />
          <div className="flex flex-col gap-2">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("settings.shellEnvironment.statusLabel")}
              </span>{" "}
              <span className="font-medium">{statusText}</span>
            </div>
            {showSkipReason && skipReasonKey ? (
              <div className="text-muted-foreground text-sm">
                {t(skipReasonKey)}
              </div>
            ) : null}
            {showFailureDetail ? (
              <div className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
                {hostStatus?.error}
              </div>
            ) : null}
            <div>
              <Button
                disabled={loading || isWindows}
                onClick={() => {
                  refreshHostStatus().catch(() => undefined);
                }}
                type="button"
                variant="outline"
              >
                {loading
                  ? t("settings.shellEnvironment.refreshing")
                  : t("settings.shellEnvironment.refresh")}
              </Button>
            </div>
          </div>
          <FieldSeparator />
          <SwitchRow
            checked={disabled}
            description={t("settings.shellEnvironment.disabledDesc")}
            id="settings-shell-env-disabled"
            label={t("settings.shellEnvironment.disabled")}
            onCheckedChange={(next) => {
              setDisabled(next).catch(() => undefined);
            }}
          />
          <FieldSeparator />
          <InputRow
            description={t("settings.shellEnvironment.timeoutDesc")}
            id="settings-shell-env-timeout"
            inputClassName="w-24"
            inputMode="numeric"
            label={t("settings.shellEnvironment.timeout")}
            max={120}
            min={1}
            onBlur={(raw) => {
              const seconds = Number.parseInt(raw, 10);
              if (Number.isNaN(seconds)) {
                setTimeoutDraft(String(timeoutMs / 1000));
                return;
              }
              const nextMs = Math.min(120, Math.max(1, seconds)) * 1000;
              setTimeoutDraft(String(nextMs / 1000));
              if (nextMs !== timeoutMs) {
                setTimeoutMs(nextMs).catch(() => undefined);
              }
            }}
            onChange={setTimeoutDraft}
            step={1}
            type="number"
            value={timeoutDraft}
          />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
