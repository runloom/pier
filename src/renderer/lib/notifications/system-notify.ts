/**
 * 系统事件门面（设计文档 §4 tap-in 的落地形态）。
 *
 * 后台/系统事件的唯一上报入口：异步上报 NCS 落档；形态 B toast 由 main 按
 * DeliveryPlan 单窗回投（Strict main-owned，见 2026-07-26 多窗金标准）。
 * 用户动作的即时反馈不走这里（继续用裸 toast，不留痕）。
 *
 * 本门面不再本地渲染形态 B：
 *   1. 近因 dedupe / 显式 suppressToast → report.suppressToast，main 不弹；
 *   2. mutedKinds / DND 由 main 以权威 prefs 再判；
 *   3. toast 渲染只信 `onMessageToast` 单投。
 */
import type {
  NotificationAction,
  NotificationKind,
  NotificationReport,
  NotificationSeverity,
} from "@shared/contracts/notification-center.ts";
import { NOTIFICATION_DEDUPE_WINDOW_MS } from "@shared/contracts/notification-center.ts";
import i18next from "i18next";
import {
  notificationCenterHydration,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";

/**
 * 本地近因 dedupe：镜像只随 main 广播更新，「report 已发但广播未回」的 IPC 往返
 * 窗口内同 key 连发会二次 ingest。本表在第二次起带 suppressToast，避免 main 连弹。
 */
const recentReportKeys = new Map<string, number>();

/** 测试专用：清空本地近因 dedupe（模块级状态跨用例隔离）。 */
export function resetSystemNotifyRecentKeysForTests(): void {
  recentReportKeys.clear();
}

function pruneRecentReportKeys(now: number): void {
  for (const [key, ts] of recentReportKeys) {
    if (now - ts > NOTIFICATION_DEDUPE_WINDOW_MS) {
      recentReportKeys.delete(key);
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
  const { items } = useNotificationCenterStore.getState();
  const now = Date.now();
  pruneRecentReportKeys(now);
  const alreadyRecorded = input.dedupeKey
    ? items.some(
        (item) =>
          item.dedupeKey === input.dedupeKey &&
          now - item.ts <= NOTIFICATION_DEDUPE_WINDOW_MS
      ) || recentReportKeys.has(input.dedupeKey)
    : false;
  const suppressToast = input.suppressToast ?? alreadyRecorded;

  if (input.dedupeKey && !suppressToast) {
    recentReportKeys.set(input.dedupeKey, now);
  } else if (input.dedupeKey && alreadyRecorded && !input.suppressToast) {
    // 连发路径：仍记 key，保证第三次起继续 suppress
    recentReportKeys.set(input.dedupeKey, now);
  }

  if (!(input.body || suppressToast) && import.meta.env.DEV) {
    console.warn(
      `[systemNotify] toast 详情缺失：kind=${input.kind} titleKey=${input.titleKey}。请补 body 提供友好内容（下一步/上下文/摘要），类型行回退仅为防御兜底。`
    );
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
    ...(suppressToast ? { suppressToast: true } : {}),
  };
  // 落档是尽力投递：上报失败/preload 未就绪只留日志；形态 B 由 main 回投。
  try {
    window.pier.notificationCenter.report(report).catch(() => undefined);
  } catch {
    // window.pier 未注入（单测/非 Electron 环境）时静默
  }
}
