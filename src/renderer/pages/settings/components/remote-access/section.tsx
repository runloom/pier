import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import type {
  RemoteAccessDevice,
  RemoteAccessPairingChallenge,
  RemoteAccessState,
} from "@preload/remote-access/api.ts";
import { Copy, QrCode, Trash2 } from "lucide-react";
import { toCanvas } from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

/** 开启期间 getState 轮询间隔（简报：2s，仅本 section 挂载期间）。 */
const POLL_INTERVAL_MS = 2000;
/** 配对码倒计时秒针间隔。 */
const COUNTDOWN_TICK_MS = 1000;
const QR_CANVAS_SIZE = 168;

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatLastSeen(lastSeenAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(lastSeenAt));
}

/** QR canvas：qrcode.toCanvas 渲染 qrPayload 自描述 JSON（规格 §17.2）。 */
function PairingQr({ payload }: { payload: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    toCanvas(canvas, payload, { margin: 1, width: QR_CANVAS_SIZE }).catch(
      () => undefined
    );
  }, [payload]);
  return <canvas data-testid="remote-access-qr" ref={canvasRef} />;
}

/**
 * 设置页「远程访问」卡（M1，Task 10）。
 *
 * 状态镜像：挂载即取一次 getState；enabled 期间每 2s 轮询，卸载即停。
 * 配对码 QR/明文/倒计时只来自 beginPairing 当次响应（6 位明码只出现在
 * 该响应），轮询拿到 pendingPairing === null（被兑换/取消/过期）即收起。
 * 吊销成功不另加 toast——设备从列表消失即自然 UI 反馈。
 */
export function RemoteAccessSection() {
  const t = useT();
  const [state, setState] = useState<RemoteAccessState | null>(null);
  const [challenge, setChallenge] =
    useState<RemoteAccessPairingChallenge | null>(null);
  const [generating, setGenerating] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sync = useCallback(async () => {
    const next = await window.pier.remoteAccess.getState();
    if (!mountedRef.current) {
      return;
    }
    setState(next);
    setChallenge((current) => {
      if (current === null) {
        return null;
      }
      if (next.pendingPairing === null || Date.now() >= current.expiresAt) {
        return null;
      }
      return current;
    });
  }, []);

  const enabled = state?.enabled ?? false;

  // 挂载即取一次快照；此后开启期间每 2s 轮询，卸载即停。
  useEffect(() => {
    sync().catch(() => undefined);
  }, [sync]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => {
      sync().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, sync]);

  // 配对码倒计时秒针；归零即收起 QR（配对码过期）。
  useEffect(() => {
    if (challenge === null) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [challenge]);

  const remainingSeconds =
    challenge === null
      ? 0
      : Math.max(0, Math.ceil((challenge.expiresAt - nowMs) / 1000));

  useEffect(() => {
    if (challenge !== null && remainingSeconds === 0) {
      setChallenge(null);
    }
  }, [challenge, remainingSeconds]);

  const onToggle = async (checked: boolean) => {
    try {
      await window.pier.remoteAccess.setEnabled(checked);
      await sync();
    } catch (error) {
      await showAppAlert({
        body: errorDetail(error),
        title: t("settings.remoteAccess.toggleFailedTitle"),
      });
    }
  };

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const next = await window.pier.remoteAccess.beginPairing();
      if (!mountedRef.current) {
        return;
      }
      setNowMs(Date.now());
      setChallenge(next);
    } catch (error) {
      await showAppAlert({
        body: errorDetail(error),
        title: t("settings.remoteAccess.generateFailedTitle"),
      });
    } finally {
      if (mountedRef.current) {
        setGenerating(false);
      }
    }
  };

  const onRevoke = async (device: RemoteAccessDevice) => {
    const confirmed = await showAppConfirm({
      body: t("settings.remoteAccess.revokeConfirmBody", {
        name: device.name,
      }),
      confirmLabel: t("settings.remoteAccess.revoke"),
      intent: "destructive",
      title: t("settings.remoteAccess.revokeConfirmTitle"),
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.pier.remoteAccess.revokeDevice(device.deviceId);
      await sync();
    } catch (error) {
      await showAppAlert({
        body: errorDetail(error),
        title: t("settings.remoteAccess.revokeFailedTitle"),
      });
    }
  };

  const devices = state?.devices ?? [];
  const address =
    state?.host !== null && state?.host !== undefined && state.port !== null
      ? `http://${state.host}:${state.port}`
      : null;

  return (
    <div className="px-4 pb-4" id="remoteAccess">
      <h1 className="mb-4 text-xl">{t("settings.section.remoteAccess")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.remoteAccess.title")}</CardTitle>
          <CardDescription>
            {t("settings.remoteAccess.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {enabled ? (
            <Alert variant="info">
              <AlertTitle>
                {t("settings.remoteAccess.boundaryTitle")}
              </AlertTitle>
              <AlertDescription>
                {t("settings.remoteAccess.boundaryBody")}
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldSet>
            <SwitchRow
              checked={enabled}
              description={t("settings.remoteAccess.enableDesc")}
              disabled={state === null}
              id="settings-remote-access-enabled"
              label={t("settings.remoteAccess.enableLabel")}
              onCheckedChange={onToggle}
            />
          </FieldSet>
          {enabled && address !== null ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{t("settings.remoteAccess.addressLabel")}</span>
              <code
                className="font-mono text-xs"
                data-testid="remote-access-address"
              >
                {address}
              </code>
            </div>
          ) : null}
          {enabled ? (
            <div className="flex flex-col gap-3">
              <div>
                <Button
                  data-testid="remote-access-generate"
                  disabled={generating}
                  onClick={onGenerate}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <QrCode aria-hidden data-icon="inline-start" />
                  {t("settings.remoteAccess.generateCode")}
                </Button>
              </div>
              {challenge === null ? null : (
                <div className="flex items-start gap-4">
                  <PairingQr payload={challenge.qrPayload} />
                  <div className="flex flex-col gap-1">
                    <div
                      className="font-mono text-2xl tracking-widest"
                      data-testid="remote-access-code"
                    >
                      {challenge.code}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.remoteAccess.codeExpiresIn", {
                        time: formatCountdown(remainingSeconds),
                      })}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.remoteAccess.pairingHint")}
                    </div>
                    <div className="mt-1">
                      <Button
                        data-testid="remote-access-copy-payload"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(challenge.qrPayload)
                            .then(() => {
                              toast.success(
                                t("settings.remoteAccess.copyPayloadDone")
                              );
                            })
                            .catch(() => {
                              toast.error(
                                t(
                                  "settings.remoteAccess.copyPayloadFailedTitle"
                                )
                              );
                            });
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Copy aria-hidden data-icon="inline-start" />
                        {t("settings.remoteAccess.copyPayload")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {enabled && (state?.remote.configured ?? false) ? (
            <>
              <FieldSeparator />
              <div className="flex flex-col gap-2">
                <div className="font-medium text-sm">
                  {t("settings.remoteAccess.remoteTitle")}
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("settings.remoteAccess.remoteDesc")}
                </p>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("settings.remoteAccess.remoteStatusLabel")}</span>
                  <span
                    className="text-muted-foreground"
                    data-testid="remote-access-remote-state"
                  >
                    {t(
                      `settings.remoteAccess.remoteState.${state?.remote.connectionState ?? "stopped"}`
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("settings.remoteAccess.keepAwakeHint")}
                </p>
              </div>
            </>
          ) : null}
          <FieldSeparator />
          <div className="flex flex-col gap-2">
            <div className="font-medium text-sm">
              {t("settings.remoteAccess.devicesTitle")}
            </div>
            {devices.length === 0 ? (
              <div
                className="text-muted-foreground text-sm"
                data-testid="remote-access-devices-empty"
              >
                {t("settings.remoteAccess.devicesEmpty")}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {devices.map((device) => (
                  <li
                    className="flex items-center justify-between gap-3"
                    data-testid="remote-access-device"
                    key={device.deviceId}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{device.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {t("settings.remoteAccess.deviceMeta", {
                          shell: t(
                            `settings.remoteAccess.shell.${device.shell}`
                          ),
                          time: formatLastSeen(device.lastSeenAt),
                        })}
                      </span>
                    </div>
                    <Button
                      data-testid="remote-access-revoke"
                      onClick={() => onRevoke(device)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden data-icon="inline-start" />
                      {t("settings.remoteAccess.revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
