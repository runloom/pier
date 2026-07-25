/**
 * 消息投递路由（设计文档 §3.2 / 2026-07-26 多窗金标准）。
 *
 * - `routeDelivery`：是否 toast / inbox / os（main 与 renderer 共用布尔决策）。
 * - `resolveToastTarget`：形态 B 投到哪一窗（仅 main 消费；renderer 不得自弹）。
 *
 * 规则：
 * - inbox 恒 true（上报侧已筛掉纯用户动作反馈）。
 * - toast 布尔：suppressToast → mutedKinds → DND（error 除外）。
 * - toast 目标：task-run + origin → origin-window；否则 key-window；无 toast → none。
 * - osNotify：恒 false（OS 发送权唯一留在 agent-attention）。
 */
import type {
  NotificationKind,
  NotificationSeverity,
} from "@shared/contracts/notification-center.ts";

export interface NotificationDeliveryDecision {
  inbox: boolean;
  osNotify: boolean;
  toast: boolean;
}

/** 形态 B in-app toast 的窗目标（main 单投）。 */
export type ToastTarget =
  | { mode: "none" }
  | { mode: "key-window" }
  | { mode: "origin-window"; originWindowId: string };

/** 有明确窗归属、优先投 origin 的 kind。 */
const ORIGIN_AWARE_KINDS: ReadonlySet<NotificationKind> = new Set([
  "task-run.finished",
]);

export function routeDelivery(
  input: {
    kind: NotificationKind;
    severity: NotificationSeverity;
    suppressToast?: boolean;
  },
  prefs: { dndEnabled: boolean; mutedKinds: readonly NotificationKind[] }
): NotificationDeliveryDecision {
  let toast = true;
  if (input.suppressToast) {
    toast = false;
  }
  if (prefs.mutedKinds.includes(input.kind)) {
    toast = false;
  }
  if (prefs.dndEnabled && input.severity !== "error") {
    toast = false;
  }
  return { inbox: true, osNotify: false, toast };
}

/**
 * 在 `routeDelivery.toast === true` 时选出单投目标。
 * - origin-aware kind 且带 originWindowId → origin-window
 * - 否则 key-window（无 key 时 send 层不弹，不 fallback 随机窗）
 */
export function resolveToastTarget(
  input: {
    kind: NotificationKind;
    severity: NotificationSeverity;
    suppressToast?: boolean;
    originWindowId?: string;
  },
  prefs: { dndEnabled: boolean; mutedKinds: readonly NotificationKind[] }
): ToastTarget {
  const decision = routeDelivery(input, prefs);
  if (!decision.toast) {
    return { mode: "none" };
  }
  if (
    ORIGIN_AWARE_KINDS.has(input.kind) &&
    input.originWindowId &&
    input.originWindowId.length > 0
  ) {
    return { mode: "origin-window", originWindowId: input.originWindowId };
  }
  return { mode: "key-window" };
}
