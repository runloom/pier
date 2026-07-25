/**
 * NotificationCenterService（NCS）：统一消息流水线 main 侧唯一写入方。
 *
 * ingest → schema 校验 → dedupe 合并 → ring buffer → 广播快照。
 * 边界纪律：本模块不 import services/agents/（对齐 foreground-activity 先例）；
 * agent 事件经 agent-attention 已分类的产物输入（M2 接入）。
 *
 * toast 预览由 renderer 门面本地决定（不等 main 往返）；本服务只负责
 * 落档、去重、未读数与快照广播。
 */
import {
  type AppNotification,
  type NotificationCenterPrefs,
  type NotificationCenterSnapshot,
  notificationReportSchema,
} from "@shared/contracts/notification-center.ts";
import { decideDedupe } from "./dedupe.ts";
import type { NotificationHistoryStore } from "./store.ts";

export interface NotificationCenterServiceDeps {
  broadcast: (snapshot: NotificationCenterSnapshot) => void;
  history: NotificationHistoryStore;
  idGen?: () => string;
  now?: () => number;
  readPrefs: () => Promise<NotificationCenterPrefs>;
  writeDnd: (enabled: boolean) => Promise<void>;
}

export interface NotificationCenterService {
  /** 退出前强制落盘（500ms 防抖窗口内的已读/新消息不丢）。 */
  flush(): Promise<void>;
  ingest(report: unknown): AppNotification | null;
  markAllRead(): void;
  markRead(id: string): void;
  /** toast 上的 action 触达时按 dedupeKey 标已读（toast 副本 id 不在历史中）。 */
  markReadByDedupeKey(dedupeKey: string): void;
  setDnd(enabled: boolean): Promise<void>;
  snapshot(): NotificationCenterSnapshot;
  /** preferences.changed 外部写入（设置页）后同步缓存；dndEnabled 变化时广播。 */
  syncPrefs(next: NotificationCenterPrefs): void;
}

export async function createNotificationCenterService(
  deps: NotificationCenterServiceDeps
): Promise<NotificationCenterService> {
  const now = deps.now ?? Date.now;
  const idGen = deps.idGen ?? crypto.randomUUID.bind(crypto);
  const prefs: NotificationCenterPrefs = await deps.readPrefs();
  let seq = 0;

  deps.history.pruneExpired(prefs.retentionDays, now());

  function snapshot(): NotificationCenterSnapshot {
    // 惰性清理：快照不含超期项（长跑闲置期间超期未读不撑高计数/徽标）。
    deps.history.pruneExpired(prefs.retentionDays, now());
    const items = deps.history.items();
    return {
      dndEnabled: prefs.dndEnabled,
      items,
      seq,
      unreadCount: items.filter((item) => !item.read).length,
    };
  }

  function publish(): void {
    seq += 1;
    deps.broadcast(snapshot());
  }

  function ingest(report: unknown): AppNotification | null {
    const parsed = notificationReportSchema.safeParse(report);
    if (!parsed.success) {
      console.warn(
        "[notification-center] invalid report dropped:",
        parsed.error.issues[0]?.message
      );
      return null;
    }
    const input = parsed.data;
    const ts = now();

    const { existingId } = decideDedupe(deps.history.items(), {
      dedupeKey: input.dedupeKey,
      ts,
    });
    if (existingId) {
      const existing = deps.history
        .items()
        .find((item) => item.id === existingId);
      const merged = deps.history.mergeExisting(existingId, {
        ...input,
        read: false,
        repeatCount: (existing?.repeatCount ?? 1) + 1,
        ts,
      });
      if (merged) {
        deps.history.pruneExpired(prefs.retentionDays, ts);
        publish();
        return merged;
      }
    }

    const notification: AppNotification = {
      ...input,
      id: idGen(),
      read: false,
      ts,
    };
    deps.history.prepend(notification);
    deps.history.pruneExpired(prefs.retentionDays, ts);
    publish();
    return notification;
  }

  return {
    flush: () => deps.history.flush(),
    ingest,
    markAllRead: () => {
      deps.history.markAllRead();
      publish();
    },
    markRead: (id) => {
      if (deps.history.markRead(id)) {
        publish();
      }
    },
    markReadByDedupeKey: (dedupeKey) => {
      const latest = deps.history
        .items()
        .find((item) => item.dedupeKey === dedupeKey);
      if (latest && deps.history.markRead(latest.id)) {
        publish();
      }
    },
    setDnd: async (enabled) => {
      if (enabled === prefs.dndEnabled) {
        return;
      }
      await deps.writeDnd(enabled);
      prefs.dndEnabled = enabled;
      publish();
    },
    snapshot,
    syncPrefs: (next) => {
      const dndChanged = next.dndEnabled !== prefs.dndEnabled;
      prefs.dndEnabled = next.dndEnabled;
      prefs.retentionDays = next.retentionDays;
      prefs.mutedKinds = [...next.mutedKinds];
      prefs.showUnreadBadge = next.showUnreadBadge;
      if (dndChanged) {
        publish();
      }
    },
  };
}
