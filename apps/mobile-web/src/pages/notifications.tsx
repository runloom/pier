/**
 * N1 通知页：notifications.list 展示 + notifications.mark-read（单条/全部）。
 * 当前活跃主机的收件箱投影；条目为 NCS 指针级消息（id/title/severity/read/ts）。
 */
import { useCallback, useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { getMobileClient } from "../lib/session.ts";

interface NotificationItem {
  body?: string;
  id: string;
  kind: string;
  read: boolean;
  severity: string;
  title: string;
  ts: number;
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

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    reload();
  }, [reload]);

  const markRead = (id: string) => {
    getMobileClient()
      .command({ id, type: "notifications.mark-read" })
      .then(reload)
      .catch(() => {
        setError("标记已读失败");
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
            className="rounded border border-neutral-600 px-2 py-1 text-[10px]"
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
                    className="mt-2 text-[10px] text-neutral-400 underline"
                    data-testid={`notification-read-${item.id}`}
                    onClick={() => {
                      markRead(item.id);
                    }}
                    type="button"
                  >
                    标为已读
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
