/**
 * NotificationCenterService（NCS）：统一消息流水线 main 侧唯一写入方。
 *
 * ingest → schema 校验 → dedupe 合并 → ring buffer → 广播快照 → 形态 B toast 单投。
 * 边界纪律：本模块不 import services/agents/（对齐 foreground-activity 先例）；
 * agent 事件经 agent-attention 已分类的产物输入。
 *
 * 形态 B toast 由 main `resolveToastTarget` + `deliverToast` 单窗投递；
 * renderer 不得订阅快照后自弹（见 2026-07-26 多窗投递金标准）。
 */
import {
  type AppNotification,
  type NotificationCenterPrefs,
  type NotificationCenterSnapshot,
  notificationReportSchema,
} from "@shared/contracts/notification-center.ts";
import {
  resolveToastTarget,
  type ToastTarget,
} from "@shared/notification-delivery.ts";
import { decideDedupe } from "./dedupe.ts";
import type { NotificationHistoryStore } from "./store.ts";

export interface NotificationIngestContext {
  /** 上报方 electron window id（字符串）；origin-aware kind 单投用。 */
  originWindowId?: string;
}

export interface NotificationCenterServiceDeps {
  broadcast: (snapshot: NotificationCenterSnapshot) => void;
  /** 形态 B toast 单投；target.mode=none 时可不调或 no-op。 */
  deliverToast?: (notification: AppNotification, target: ToastTarget) => void;
  history: NotificationHistoryStore;
  idGen?: () => string;
  now?: () => number;
  readPrefs: () => Promise<NotificationCenterPrefs>;
  writeDnd: (enabled: boolean) => Promise<void>;
}

export interface NotificationCenterService {
  /** 退出前强制落盘（500ms 防抖窗口内的已读/新消息不丢）。 */
  flush(): Promise<void>;
  ingest(
    report: unknown,
    context?: NotificationIngestContext
  ): AppNotification | null;
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

  function scheduleToast(
    notification: AppNotification,
    suppressToast: boolean | undefined,
    context: NotificationIngestContext | undefined
  ): void {
    if (!deps.deliverToast) {
      return;
    }
    const target = resolveToastTarget(
      {
        kind: notification.kind,
        severity: notification.severity,
        ...(suppressToast === undefined ? {} : { suppressToast }),
        ...(context?.originWindowId
          ? { originWindowId: context.originWindowId }
          : {}),
      },
      { dndEnabled: prefs.dndEnabled, mutedKinds: prefs.mutedKinds }
    );
    if (target.mode === "none") {
      return;
    }
    deps.deliverToast(notification, target);
  }

  function ingest(
    report: unknown,
    context?: NotificationIngestContext
  ): AppNotification | null {
    const parsed = notificationReportSchema.safeParse(report);
    if (!parsed.success) {
      console.warn(
        "[notification-center] invalid report dropped:",
        parsed.error.issues[0]?.message
      );
      return null;
    }
    const { suppressToast, ...input } = parsed.data;
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
        scheduleToast(merged, suppressToast, context);
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
    scheduleToast(notification, suppressToast, context);
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
