/**
 * 消息投递路由矩阵（设计文档 §3.2 / §3.3 的纯函数实现，main 与 renderer 共用）。
 *
 * - renderer：`systemNotify()` 门面用它决定「本地是否立即弹 toast」（toast 不等待 main 往返）。
 * - main：NCS 在 M2 用它决定 agent 类消息的 toast 预览 / OS 通知位。
 *
 * 规则：
 * - inbox 恒为 true：到达消息中心的消息一律落档（上报侧已筛掉纯用户动作反馈）。
 * - toast：按类静音（mutedKinds）→ DND（error 除外）→ 上报方 suppressToast 依次否决。
 * - osNotify：M1 恒 false（OS 通知发送权唯一留在 agent-attention，M2 接入）。
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
