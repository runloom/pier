/**
 * H1 主机列表：localStorage 已配对宿主 + 帧客户端连接状态（仅当前活跃台
 * 反映真实连接态，其余台标离线）。点选即连接并进入 H2 工作台。
 */
import { useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import {
  hostKey,
  loadHosts,
  removeHost,
  type StoredHost,
} from "../lib/paired-hosts.ts";
import { navigate } from "../lib/routes.ts";
import { activeHostKey, connectHost } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

function statusTextFor(
  stored: StoredHost,
  active: string | null,
  connection: string
): string {
  if (active === null || active !== hostKey(stored.host, stored.port)) {
    return "离线";
  }
  if (connection === "connected") {
    return "在线";
  }
  if (connection === "connecting" || connection === "reconnecting") {
    return "连接中…";
  }
  return "离线";
}

export function HostsPage() {
  const [hosts, setHosts] = useState<StoredHost[]>(() => loadHosts());
  const connection = useMobileWebStore((state) => state.connection);
  const active = activeHostKey();
  const [enterError, setEnterError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    setHosts(loadHosts());
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar title="主机" />
      <main className="flex-1 px-4 py-4">
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
              const key = hostKey(stored.host, stored.port);
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
                      {statusTextFor(stored, active, connection)}
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
                              message:
                                err instanceof Error
                                  ? `连接失败：${err.message}`
                                  : "连接失败，请稍后重试",
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
                        removeHost(stored.host, stored.port);
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
