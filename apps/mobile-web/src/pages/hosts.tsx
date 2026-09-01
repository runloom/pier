/**
 * H1 主机列表：localStorage 已配对宿主 + 帧客户端连接状态（仅当前活跃台
 * 反映真实连接态，其余台标离线）。点选即连接并进入 H2 工作台。
 */
import { useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import {
  FATAL_AUTH_CODES,
  PierMobileClientError,
} from "../lib/client-types.ts";
import {
  canReachViaRelay,
  loadHosts,
  removeHostByKey,
  type StoredHost,
  storedHostKey,
} from "../lib/paired-hosts.ts";
import { fetchHostsStatus } from "../lib/relay-api.ts";
import { navigate } from "../lib/routes.ts";
import {
  activeHostKey,
  connectHost,
  resumeActiveHost,
} from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

/** 在线态自动重试间隔（页面可见期间）。 */
const STATUS_REFRESH_INTERVAL_MS = 30_000;

/**
 * 三态在线视图：true 在线 / false 离线（宿主未出站）/ null 与缺省 = 状态未知
 * （在线态查询失败或尚未返回）。「远程连接不可用」不得伪装成「电脑离线」。
 */
type RelayOnlineView = Map<string, boolean | null>;

function statusTextFor(
  stored: StoredHost,
  active: string | null,
  connection: string,
  relayOnline: RelayOnlineView
): string {
  const key = storedHostKey(stored);
  // 会合明确说这台宿主离线：后台重连循环是自愈机制，不是用户状态——
  // 显示「离线」，不许挂「连接中…」空转（桌面未启动时的常态）。
  const relaySaysOffline =
    canReachViaRelay(stored) && relayOnline.get(stored.hostId) === false;
  // 当前活跃台反映真实连接态。
  if (active === key) {
    if (connection === "connected") {
      return "在线";
    }
    if (
      (connection === "connecting" || connection === "reconnecting") &&
      !relaySaysOffline
    ) {
      return "连接中…";
    }
  }
  // 非活跃 relay 宿主：会合在线态查询结果（跨网可见其它宿主是否在线）。
  if (canReachViaRelay(stored)) {
    const online = relayOnline.get(stored.hostId);
    if (online === true) {
      return "在线";
    }
    if (online === false) {
      return "离线";
    }
    return "状态未知";
  }
  return "离线";
}

function isFatalAuthError(err: unknown): err is PierMobileClientError {
  return (
    err instanceof PierMobileClientError && FATAL_AUTH_CODES[err.code] === true
  );
}

/** 进入失败：吊销/鉴权 ≠ 电脑离线 ≠ 远程暂不可用 ≠ 同网直连失败。 */
function enterFailureMessage(
  stored: StoredHost,
  relayOnline: RelayOnlineView,
  err: unknown
): string {
  if (isFatalAuthError(err)) {
    return "本设备已在电脑上被吊销，请移除本条目后重新扫码配对";
  }
  if (canReachViaRelay(stored)) {
    if (relayOnline.get(stored.hostId) === false) {
      return "这台电脑目前离线：请让它保持开机与唤醒，并确认已开启远程访问。若它确认在线仍显示离线，本设备可能已在电脑上被吊销——请移除本条目后重新扫码配对";
    }
    return err instanceof Error
      ? `远程连接失败：${err.message}`
      : "远程连接暂时不可用，请稍后重试";
  }
  return err instanceof Error
    ? `连接失败：${err.message}`
    : "连接失败，请稍后重试";
}

export function HostsPage() {
  const [hosts, setHosts] = useState<StoredHost[]>(() => loadHosts());
  const connection = useMobileWebStore((state) => state.connection);
  const active = activeHostKey();
  const [relayOnline, setRelayOnline] = useState<RelayOnlineView>(
    () => new Map()
  );
  const [enterError, setEnterError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    setHosts(loadHosts());
  }, []);

  // 会合在线态：对 relay 宿主批量查询（relayPass 派生不落盘）。按 relayUrl
  // 分组；查询失败的组整组标「状态未知」（null），并自动重试（定时 + 回前台）。
  useEffect(() => {
    const reachable = hosts.filter(canReachViaRelay);
    if (reachable.length === 0) {
      return;
    }
    let cancelled = false;
    const byRelay = new Map<string, typeof reachable>();
    for (const stored of reachable) {
      byRelay.set(stored.relayUrl, [
        ...(byRelay.get(stored.relayUrl) ?? []),
        stored,
      ]);
    }
    const refresh = () => {
      Promise.all(
        [...byRelay.entries()].map(async ([relayUrl, group]) => ({
          group,
          result: await fetchHostsStatus(
            relayUrl,
            group.map((stored) => ({
              deviceId: stored.deviceId,
              deviceToken: stored.deviceToken,
              fingerprint: stored.fingerprint,
              hostId: stored.hostId,
            }))
          ),
        }))
      )
        .then((settled) => {
          if (cancelled) {
            return;
          }
          const merged: RelayOnlineView = new Map();
          for (const { group, result } of settled) {
            if (result === null) {
              for (const stored of group) {
                merged.set(stored.hostId, null);
              }
              continue;
            }
            for (const [hostId, online] of result) {
              merged.set(hostId, online);
            }
          }
          setRelayOnline(merged);
          // 会合说当前活跃宿主已在线而我们仍断着：立即重拨，
          // 不等重连退避周期（状态查询与拨号循环联动）。
          const activeStored = reachable.find(
            (stored) => storedHostKey(stored) === activeHostKey()
          );
          if (
            activeStored !== undefined &&
            merged.get(activeStored.hostId) === true &&
            useMobileWebStore.getState().connection !== "connected"
          ) {
            resumeActiveHost().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startTimer = () => {
      stopTimer();
      timer = setInterval(refresh, STATUS_REFRESH_INTERVAL_MS);
    };
    if (document.visibilityState === "visible") {
      startTimer();
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        startTimer();
      } else {
        stopTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hosts]);

  const relayStatusUnknown = [...relayOnline.values()].some(
    (online) => online === null
  );

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar title="主机" />
      <main className="flex-1 px-4 py-4">
        {relayStatusUnknown && (
          <p
            className="mb-3 rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-amber-300 text-xs"
            data-testid="hosts-relay-unreachable"
            role="status"
          >
            远程连接暂时不可用，主机状态未知，将自动重试。
          </p>
        )}
        {hosts.length === 0 ? (
          <div className="mt-16 text-center" data-testid="hosts-empty">
            <p className="text-neutral-400 text-sm">还没有已配对的设备</p>
            <p className="mt-1 text-neutral-500 text-xs">
              在桌面端出示配对二维码，在此添加你的第一台开发机
            </p>
            <button
              className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm text-white"
              data-testid="hosts-empty-add"
              onClick={() => {
                navigate({ page: "pair" });
              }}
              type="button"
            >
              去配对
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {hosts.map((stored) => {
              const key = storedHostKey(stored);
              const isActive = active === key;
              return (
                <li
                  className={`rounded border p-3 ${
                    isActive
                      ? "border-emerald-700 bg-neutral-900"
                      : "border-neutral-800 bg-neutral-900/60"
                  }`}
                  data-testid="host-item"
                  key={key}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      {stored.name ?? stored.host}
                    </span>
                    <span className="text-neutral-400 text-xs">
                      {statusTextFor(stored, active, connection, relayOnline)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-neutral-500">
                    {stored.host}:{stored.port}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded bg-neutral-800 px-3 py-1 text-neutral-100 text-xs"
                      data-testid={`host-enter-${key}`}
                      onClick={() => {
                        setEnterError(null);
                        connectHost(stored)
                          .then(() => {
                            navigate({ page: "host" });
                          })
                          .catch((err: unknown) => {
                            // 连接失败：行内提示，不静默跳转 H2。
                            setEnterError({
                              key,
                              message: enterFailureMessage(
                                stored,
                                relayOnline,
                                err
                              ),
                            });
                          });
                      }}
                      type="button"
                    >
                      进入
                    </button>
                    <button
                      className="rounded px-3 py-1 text-neutral-500 text-xs"
                      data-testid={`host-remove-${key}`}
                      onClick={() => {
                        removeHostByKey(key);
                        setHosts(loadHosts());
                      }}
                      type="button"
                    >
                      移除
                    </button>
                  </div>
                  {enterError !== null && enterError.key === key && (
                    <p
                      className="mt-2 text-red-400 text-xs"
                      data-testid={`host-error-${key}`}
                      role="alert"
                    >
                      {enterError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <button
          className="mt-4 text-neutral-400 text-xs underline"
          data-testid="hosts-add"
          onClick={() => {
            navigate({ page: "pair" });
          }}
          type="button"
        >
          添加设备
        </button>
      </main>
    </div>
  );
}
