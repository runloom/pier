/**
 * 系统事件门面（设计文档 §4 tap-in 的落地形态）。
 *
 * 后台/系统事件的唯一上报入口：本地立即 toast（不等 main 往返）+ 异步上报 NCS 落档。
 * 用户动作的即时反馈不走这里（继续用裸 toast，不留痕）。
 *
 * toast 抑制的完整判定（顺序）：
 *   1. 同 dedupeKey 已在消息中心 → 不再 toast（记录由 NCS 合并，去重下沉的唯一实现）；
 *   2. suppressToast（调用方显式只落档）；
 *   3. 路由矩阵（mutedKinds / DND，error 不受 DND 影响）。
 */
import type {
  AppNotification,
  NotificationAction,
  NotificationKind,
  NotificationReport,
  NotificationSeverity,
} from "@shared/contracts/notification-center.ts";
import { NOTIFICATION_DEDUPE_WINDOW_MS } from "@shared/contracts/notification-center.ts";
import { routeDelivery } from "@shared/notification-delivery.ts";
import i18next from "i18next";
import {
  notificationCenterHydration,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";

/**
 * toast 渲染槽（依赖反转）：system-notify 被 stores 静态引用，不得再把 React
 * 卡片树拉进模块图（成环）。渲染器由 show-notification-toast.tsx 在应用引导时
 * 注册；未注册时静默跳过 toast（单测/极早期启动），落档逻辑不受影响。
 */
let toastRenderer: ((notification: AppNotification) => void) | null = null;

export function registerSystemToastRenderer(
  renderer: (notification: AppNotification) => void
): void {
  toastRenderer = renderer;
}

/**
 * 本地近因 dedupe：镜像只随 main 广播更新，「toast 已弹但广播未回」的 IPC 往返
 * 窗口（以及水合重放连发）内同 key 事件会重复 toast。本表补上这段窗口——
 * toast 实际弹出时记录 key，与镜像判定并列（窗口同为 24h，惰性清理）。
 */
const recentToastKeys = new Map<string, number>();

/** 测试专用：清空本地近因 dedupe（模块级状态跨用例隔离）。 */
export function resetSystemNotifyRecentKeysForTests(): void {
  recentToastKeys.clear();
}

function pruneRecentToastKeys(now: number): void {
  for (const [key, ts] of recentToastKeys) {
    if (now - ts > NOTIFICATION_DEDUPE_WINDOW_MS) {
      recentToastKeys.delete(key);
    }
  }
}

export interface SystemNotifyInput {
  actionParams?: Record<string, string>;
  /** inbox 卡片 action（≤2，label 走 labelKey 由卡片按当前语言 resolve）。 */
  actions?: NotificationAction[];
  agentRef?: string;
  /** 详情槽位（消息摘要或技术详情，toast 单行截断展示）。 */
  body?: string;
  dedupeKey?: string;
  kind: NotificationKind;
  panelRef?: { panelId: string };
  severity: NotificationSeverity;
  source?: string;
  /** 只落消息中心、不弹 toast。 */
  suppressToast?: boolean;
  titleKey: string;
  titleParams?: Record<string, number | string>;
}

export function systemNotify(input: SystemNotifyInput): void {
  // 启动竞态：dedupe 判定依赖镜像水合。未水合且带 dedupeKey 时延后到首次
  // 快照到达再执行（仅启动期；否则跨会话 dedupe 在窗口期被绕过）。
  if (input.dedupeKey && !useNotificationCenterStore.getState().hydrated) {
    notificationCenterHydration
      .then(() => {
        systemNotify(input);
      })
      .catch(() => undefined);
    return;
  }

  const title = i18next.t(input.titleKey, input.titleParams ?? {});
  const { dndEnabled, items } = useNotificationCenterStore.getState();
  const { mutedKinds } = useNotificationCenterPrefsStore.getState().prefs;
  // dedupe 抑制窗口与 NCS 合并窗口（24h）同源：窗口内同 key 不再 toast，
  // 窗口外视为新事件（NCS 会新建条目而非合并）。
  const now = Date.now();
  pruneRecentToastKeys(now);
  const alreadyRecorded = input.dedupeKey
    ? items.some(
        (item) =>
          item.dedupeKey === input.dedupeKey &&
          now - item.ts <= NOTIFICATION_DEDUPE_WINDOW_MS
      ) || recentToastKeys.has(input.dedupeKey)
    : false;
  const decision = routeDelivery(
    {
      kind: input.kind,
      severity: input.severity,
      suppressToast: input.suppressToast ?? alreadyRecorded,
    },
    { dndEnabled, mutedKinds }
  );
  if (decision.toast) {
    if (input.dedupeKey) {
      recentToastKeys.set(input.dedupeKey, now);
    }
    if (!input.body && import.meta.env.DEV) {
      console.warn(
        `[systemNotify] toast 详情缺失：kind=${input.kind} titleKey=${input.titleKey}。请补 body 提供友好内容（下一步/上下文/摘要），类型行回退仅为防御兜底。`
      );
    }
    // 消息型 toast（形态 B）：标题 + 详情 + ≤1 outline 操作 + 关闭 X。
    toastRenderer?.({
      ...(input.actionParams ? { actionParams: input.actionParams } : {}),
      ...(input.actions ? { actions: input.actions } : {}),
      ...(input.agentRef ? { agentRef: input.agentRef } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(input.panelRef ? { panelRef: input.panelRef } : {}),
      id: `toast:${crypto.randomUUID()}`,
      kind: input.kind,
      read: false,
      severity: input.severity,
      source: input.source ?? "host",
      title,
      titleKey: input.titleKey,
      ...(input.titleParams ? { titleParams: input.titleParams } : {}),
      trigger: "system-event",
      ts: Date.now(),
    });
  }

  const report: NotificationReport = {
    kind: input.kind,
    severity: input.severity,
    source: input.source ?? "host",
    title,
    titleKey: input.titleKey,
    trigger: "system-event",
    ...(input.titleParams ? { titleParams: input.titleParams } : {}),
    ...(input.body ? { body: input.body } : {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    ...(input.panelRef ? { panelRef: input.panelRef } : {}),
    ...(input.agentRef ? { agentRef: input.agentRef } : {}),
    ...(input.actionParams ? { actionParams: input.actionParams } : {}),
    ...(input.actions ? { actions: input.actions } : {}),
  };
  // 落档是尽力投递：上报失败/preload 未就绪只留日志，不影响 toast 已给出的即时反馈。
  try {
    window.pier.notificationCenter.report(report).catch(() => undefined);
  } catch {
    // window.pier 未注入（单测/非 Electron 环境）时静默
  }
}
