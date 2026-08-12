/**
 * NCS → 形态 B toast 投递 + 与 OS 同权的打断提示音。
 * 业务策略（是否 toast）已由 resolveDeliveryPlan 决定；本模块只执行。
 */
import {
  decideNotificationAudio,
  maybePlayInterruptSound,
} from "@main/services/agent-attention/notification-audio.ts";
import type { AgentAttentionSettings } from "@shared/contracts/agent/attention.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import {
  OS_ELIGIBLE_KINDS,
  type ToastTarget,
} from "@shared/notification-delivery.ts";

export interface CreateDeliverToastArgs {
  getAttentionSettings: () => Pick<
    AgentAttentionSettings,
    "soundEnabled" | "soundId"
  >;
  /** 应用内置提示音单窗播放。 */
  sendSoundToWindow: (payload: { soundId: string }) => boolean;
  /** 单窗 toast 投递；返回是否真正发出。 */
  sendToast: (notification: AppNotification, target: ToastTarget) => boolean;
}

/**
 * toast 成功投递后，对 agent 白名单 kind 走 `maybePlayInterruptSound(channel: "toast")`。
 * send 失败 / 非白名单 kind / sound 关闭：不播。
 */
export function createDeliverToast(args: CreateDeliverToastArgs) {
  return (notification: AppNotification, target: ToastTarget): boolean => {
    const sent = args.sendToast(notification, target);
    if (sent && OS_ELIGIBLE_KINDS.has(notification.kind)) {
      maybePlayInterruptSound({
        channel: "toast",
        decision: decideNotificationAudio(args.getAttentionSettings()),
        force: false,
        sendToWindow: args.sendSoundToWindow,
      });
    }
    return sent;
  };
}
