/**
 * NotificationCenterService（NCS）：统一消息流水线 main 侧唯一写入方。
 *
 * ingest → schema 校验 → dedupe 合并 → ring buffer → 广播快照 → DeliveryPlan 调度。
 * 形态 B toast 与 OS 互斥：有 key 窗 toast；无 key 且白名单 OS。
 * 边界：本模块不 import services/agents/；agent 事件经 agent-attention 已分类产物输入。
 */
import {
  type AppNotification,
  type NotificationCenterPrefs,
  type NotificationCenterSnapshot,
  notificationReportSchema,
} from "@shared/contracts/notification-center.ts";
import {
  DEFAULT_DELIVERY_AGENT_ATTENTION,
  type DeliveryAgentAttentionPrefs,
  type DeliveryFocus,
  type OsTarget,
  resolveDeliveryPlan,
  type ToastTarget,
} from "@shared/notification-delivery.ts";
import { decideDedupe } from "./dedupe.ts";
import { createOsCooldownStore, type OsCooldownStore } from "./os-cooldown.ts";
import type { NotificationHistoryStore } from "./store.ts";

export interface NotificationIngestContext {
  /** 上报方 electron window id（字符串）；origin-aware kind 单投用。 */
  originWindowId?: string;
}

export interface NotificationCenterServiceDeps {
  broadcast: (snapshot: NotificationCenterSnapshot) => void;
  /**
   * OS 系统通知（进程级）；osTarget.mode=none 时不调。
   * 返回 shown：仅 shown 时记 OS 冷却。
   */
  deliverOs?: (
    notification: AppNotification,
    meta: { cooldownKey?: string }
  ) => boolean | Promise<boolean>;
  /** 形态 B toast 单投；target.mode=none 时不调。 */
  deliverToast?: (notification: AppNotification, target: ToastTarget) => void;
  history: NotificationHistoryStore;
  idGen?: () => string;
  now?: () => number;
  osCooldown?: OsCooldownStore;
  /** agent 注意力策略切片。缺省用 delivery 默认（与产品默认对齐）。 */
  readAgentAttentionPrefs?: () => DeliveryAgentAttentionPrefs;
  /** 投递瞬间 key-window 是否存在。缺省 true（兼容旧单测 / 无窗管理注入）。 */
  readFocusBase?: () => Pick<DeliveryFocus, "hasFocusedPierWindow">;
  readPrefs: () => Promise<NotificationCenterPrefs>;
  /**
   * agent 细粒度聚焦。NCS 不解析 agent 域；由 ipc 注入。
   * 缺省：无 panel/owner 静音。
   */
  resolveAgentFocus?: (input: {
    agentRef?: string;
    panelId?: string;
  }) => Pick<DeliveryFocus, "isTargetPanelFocused" | "isOwnerWindowFocused">;
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
  /**
   * 按当前存活 agentRef 剪枝 OS 冷却（面板关闭 / 会话结束）。
   * 由 FA 发布路径调用；不进 inbox 快照。
   */
  pruneOsCooldown(liveAgentRefs: ReadonlySet<string>): void;
  /** 按谓词删除历史项并广播（用于下线误报类消息）。 */
  removeWhere(predicate: (item: AppNotification) => boolean): number;
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
  const osCooldown = deps.osCooldown ?? createOsCooldownStore();
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

  function buildFocus(notification: AppNotification): DeliveryFocus {
    const base = deps.readFocusBase?.() ?? { hasFocusedPierWindow: true };
    const agentFocus =
      deps.resolveAgentFocus?.({
        ...(notification.agentRef ? { agentRef: notification.agentRef } : {}),
        ...(notification.panelRef?.panelId
          ? { panelId: notification.panelRef.panelId }
          : {}),
      }) ?? {};
    return {
      hasFocusedPierWindow: base.hasFocusedPierWindow,
      ...agentFocus,
    };
  }

  function scheduleDelivery(
    notification: AppNotification,
    suppressToast: boolean | undefined,
    context: NotificationIngestContext | undefined
  ): void {
    const agentAttention =
      deps.readAgentAttentionPrefs?.() ?? DEFAULT_DELIVERY_AGENT_ATTENTION;
    const plan = resolveDeliveryPlan(
      {
        kind: notification.kind,
        severity: notification.severity,
        ...(suppressToast === undefined ? {} : { suppressToast }),
        ...(context?.originWindowId
          ? { originWindowId: context.originWindowId }
          : {}),
        ...(notification.agentRef ? { agentRef: notification.agentRef } : {}),
        ...(notification.panelRef
          ? { panelId: notification.panelRef.panelId }
          : {}),
      },
      {
        agentAttention,
        dndEnabled: prefs.dndEnabled,
        mutedKinds: prefs.mutedKinds,
      },
      buildFocus(notification)
    );

    if (plan.toastTarget.mode !== "none" && deps.deliverToast) {
      deps.deliverToast(notification, plan.toastTarget);
    }

    scheduleOs(notification, plan.osTarget, plan.osCooldownKey, agentAttention);
  }

  function scheduleOs(
    notification: AppNotification,
    osTarget: OsTarget,
    osCooldownKey: string | undefined,
    agentAttention: DeliveryAgentAttentionPrefs
  ): void {
    if (osTarget.mode !== "process" || !deps.deliverOs) {
      return;
    }
    const key = osCooldownKey;
    const ts = now();
    if (key && !osCooldown.tryReserve(key, agentAttention.cooldownMs, ts)) {
      return;
    }
    const runOs = async (): Promise<void> => {
      try {
        const shown = await deps.deliverOs?.(
          notification,
          key ? { cooldownKey: key } : {}
        );
        if (!key) {
          return;
        }
        if (shown) {
          osCooldown.commit(key, ts);
        } else {
          osCooldown.release(key);
        }
      } catch (err) {
        if (key) {
          osCooldown.release(key);
        }
        console.warn("[notification-center] deliverOs failed:", err);
      }
    };
    runOs().catch((err: unknown) => {
      console.warn("[notification-center] deliverOs unexpected:", err);
    });
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
        scheduleDelivery(merged, suppressToast, context);
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
    scheduleDelivery(notification, suppressToast, context);
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
    pruneOsCooldown: (liveAgentRefs) => {
      osCooldown.prune(liveAgentRefs);
    },
    removeWhere: (predicate) => {
      const removed = deps.history.removeWhere(predicate);
      if (removed > 0) {
        publish();
      }
      return removed;
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
