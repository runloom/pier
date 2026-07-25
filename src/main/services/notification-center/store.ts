/**
 * 消息中心历史存储：内存 ring buffer + debounced 持久化。
 *
 * - 上限 NOTIFICATION_CENTER_HISTORY_LIMIT（200），按 ts 倒序（新→旧）。
 * - 持久化 {userData}/notifications.json（debouncedJsonStore，500ms 防抖）；
 *   文件损坏 / schema 校验失败 → 空历史启动，不阻塞主流程。
 * - 过期清理按 retentionDays 在 init 与每次写入时执行。
 */
import {
  type AppNotification,
  appNotificationSchema,
  NOTIFICATION_CENTER_HISTORY_LIMIT,
  type NotificationRetentionDays,
} from "@shared/contracts/notification-center.ts";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "../../state/debounced-store.ts";

const historyFileSchema = z.object({
  items: z.array(appNotificationSchema).max(NOTIFICATION_CENTER_HISTORY_LIMIT),
});

type HistoryFile = z.infer<typeof historyFileSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NotificationHistoryStore {
  flush(): Promise<void>;
  /** 全量 items（ts 倒序）。 */
  items(): AppNotification[];
  markAllRead(): void;
  markRead(id: string): boolean;
  /** dedupe 合并：更新既有条目并顶到头部。 */
  mergeExisting(
    id: string,
    patch: Partial<AppNotification>
  ): AppNotification | null;
  /** 新条目插入头部并裁剪上限。 */
  prepend(item: AppNotification): void;
  pruneExpired(retentionDays: NotificationRetentionDays, now: number): void;
}

export async function createNotificationHistoryStore(opts: {
  filePath: string;
}): Promise<NotificationHistoryStore> {
  const store: DebouncedJsonStore<HistoryFile> =
    debouncedJsonStore<HistoryFile>({
      debounceMs: 500,
      defaults: { items: [] },
      filePath: opts.filePath,
    });
  const raw = await store.init();
  const parsed = historyFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      "[notification-center] history file invalid, resetting:",
      parsed.error.issues[0]?.message
    );
    store.replace({ items: [] });
  } else if (parsed.data.items.length !== raw.items?.length) {
    store.replace(parsed.data);
  }

  function items(): AppNotification[] {
    return store.get().items;
  }

  function pruneExpired(
    retentionDays: NotificationRetentionDays,
    now: number
  ): void {
    const cutoff = now - retentionDays * DAY_MS;
    store.mutate((state) => {
      const kept = state.items.filter((item) => item.ts >= cutoff);
      return kept.length === state.items.length ? state : { items: kept };
    });
  }

  return {
    flush: () => store.flush(),
    items,
    markAllRead: () => {
      store.mutate((state) => {
        if (state.items.every((item) => item.read)) {
          return state;
        }
        return {
          items: state.items.map((item) => ({ ...item, read: true })),
        };
      });
    },
    markRead: (id) => {
      let found = false;
      store.mutate((state) => ({
        items: state.items.map((item) => {
          if (item.id !== id || item.read) {
            return item;
          }
          found = true;
          return { ...item, read: true };
        }),
      }));
      return found;
    },
    mergeExisting: (id, patch) => {
      let merged: AppNotification | null = null;
      store.mutate((state) => {
        const existing = state.items.find((item) => item.id === id);
        if (!existing) {
          return state;
        }
        merged = { ...existing, ...patch, id: existing.id };
        return {
          items: [merged, ...state.items.filter((item) => item.id !== id)],
        };
      });
      return merged;
    },
    prepend: (item) => {
      store.mutate((state) => ({
        items: [item, ...state.items].slice(
          0,
          NOTIFICATION_CENTER_HISTORY_LIMIT
        ),
      }));
    },
    pruneExpired,
  };
}
