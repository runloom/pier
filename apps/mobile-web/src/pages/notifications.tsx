/**
 * N1 通知页：notifications.list 展示 + notifications.mark-read（单条/全部）。
 * 当前活跃主机的收件箱投影；条目为 NCS 指针级消息（id/title/severity/read/ts）。
 */
import { useCallback, useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { canSubscribe, subscribeWebPush } from "../lib/push.ts";
import { navigate } from "../lib/routes.ts";
import { getMobileClient } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

interface NotificationItem {
  body?: string;
  id: string;
  kind: string;
  panelId?: string;
  read: boolean;
  severity: string;
  title: string;
  ts: number;
  windowId?: string;
}

interface NotificationsListResult {
  items: NotificationItem[];
  unreadCount: number;
}

function relativeTime(ts: number, now: number): string {
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) {
    return "刚刚";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)} 分钟前`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)} 小时前`;
  }
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

/** 订阅态：unsupported=非 standalone/无 PushManager；idle→busy→done/error。 */
type PushState = "unsupported" | "idle" | "busy" | "done" | "error";

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>(() =>
    canSubscribe() ? "idle" : "unsupported"
  );

  const enablePush = useCallback(async () => {
    setPushState("busy");
    try {
      const { publicKey } = await getMobileClient().command<{
        publicKey: string;
      }>({ type: "notifications.getPushPublicKey" });
      const handle = await subscribeWebPush(publicKey);
      if (handle === null) {
        setPushState("error");
        return;
      }
      await getMobileClient().command({
        type: "notifications.registerPushHandle",
        webPush: handle,
      });
      setPushState("done");
    } catch {
      setPushState("error");
    }
  }, []);

  const reload = useCallback(() => {
    getMobileClient()
      .command<NotificationsListResult>({ type: "notifications.list" })
      .then((result) => {
        setItems(result.items);
        setUnreadCount(result.unreadCount);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "通知读取失败");
      });
  }, []);

  // 快照 revision 变化即重拉列表：停留在本页时新通知/已读态自动出现。
  const revision = useMobileWebStore((state) => state.revision);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision 是重拉触发器，体不读取
  useEffect(() => {
    reload();
  }, [reload, revision]);

  const markRead = (id: string) => {
    getMobileClient()
      .command({ id, type: "notifications.mark-read" })
      .then(reload)
      .catch(() => {
        setError("标记已读失败");
      });
  };

  const openItem = (item: NotificationItem) => {
    if (item.panelId === undefined) {
      return;
    }
    if (!item.read) {
      getMobileClient()
        .command({ id: item.id, type: "notifications.mark-read" })
        .catch(() => {
          setError("标记已读失败");
        });
    }
    navigate({
      page: "session",
      panelId: item.panelId,
      ...(item.windowId === undefined ? {} : { windowId: item.windowId }),
    });
  };

  const markAllRead = () => {
    getMobileClient()
      .command({ all: true, type: "notifications.mark-read" })
      .then(reload)
      .catch(() => {
        setError("全部已读失败");
      });
  };

  const now = Date.now();

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title="通知" />
      <main className="flex-1 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-neutral-500 text-xs">
            当前主机收件箱 · 未读 {unreadCount}
          </p>
          <button
            className="min-h-9 rounded-md border border-neutral-600 px-3 text-neutral-200 text-xs active:bg-neutral-800"
            data-testid="notifications-mark-all"
            onClick={markAllRead}
            type="button"
          >
            全部已读
          </button>
        </div>
        {error !== null && (
          <p className="mb-3 text-red-400 text-xs" role="alert">
            {error}
          </p>
        )}
        <div className="mb-3 rounded border border-neutral-800 bg-neutral-900/60 p-3">
          {pushState === "unsupported" ? (
            <p className="text-[11px] text-neutral-500" data-testid="push-hint">
              把本页「添加到主屏幕」后，才能在离开电脑时接收「需要你处理」提醒。
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-400 text-xs">
                {pushState === "done"
                  ? "已开启离线提醒"
                  : "离开电脑时接收「需要你处理」提醒"}
              </span>
              {pushState !== "done" && (
                <button
                  className="rounded bg-emerald-600 px-3 py-1 text-white text-xs disabled:opacity-50"
                  data-testid="push-enable"
                  disabled={pushState === "busy"}
                  onClick={() => {
                    enablePush().catch(() => setPushState("error"));
                  }}
                  type="button"
                >
                  {pushState === "busy" ? "开启中…" : "开启提醒"}
                </button>
              )}
            </div>
          )}
          {pushState === "error" && (
            <p className="mt-1 text-[11px] text-red-400" role="alert">
              开启失败，请确认已授予通知权限后重试。
            </p>
          )}
        </div>
        {items.length === 0 ? (
          <p
            className="mt-8 text-center text-neutral-500 text-sm"
            data-testid="notifications-empty"
          >
            暂无通知
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                className={`rounded border p-3 ${
                  item.read
                    ? "border-neutral-800 bg-neutral-900/40"
                    : "border-neutral-700 bg-neutral-900"
                }`}
                data-testid="notification-item"
                key={item.id}
              >
                {item.panelId === undefined ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm ${item.read ? "text-neutral-400" : "font-medium text-neutral-100"}`}
                      >
                        {item.read ? "已读 · " : "未读 · "}
                        {item.title}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {relativeTime(item.ts, now)}
                      </span>
                    </div>
                    {item.body !== undefined && (
                      <p className="mt-0.5 text-[10px] text-neutral-500">
                        {item.body}
                      </p>
                    )}
                    {!item.read && (
                      <button
                        className="mt-2 min-h-9 rounded-md border border-neutral-700 px-3 text-neutral-300 text-xs active:bg-neutral-800"
                        data-testid={`notification-read-${item.id}`}
                        onClick={() => {
                          markRead(item.id);
                        }}
                        type="button"
                      >
                        标为已读
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="w-full text-left"
                    data-testid={`notification-open-${item.id}`}
                    onClick={() => {
                      openItem(item);
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm ${item.read ? "text-neutral-400" : "font-medium text-neutral-100"}`}
                      >
                        {item.read ? "已读 · " : "未读 · "}
                        {item.title}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {relativeTime(item.ts, now)}
                      </span>
                    </div>
                    {item.body !== undefined && (
                      <p className="mt-0.5 text-[10px] text-neutral-500">
                        {item.body}
                      </p>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
