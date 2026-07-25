import { routeDelivery } from "@shared/notification-delivery.ts";
import { useEffect } from "react";
import { showNotificationToast } from "@/lib/notifications/show-notification-toast.tsx";
import {
  notificationCenterHydration,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";

const PREVIEW_KINDS: ReadonlySet<string> = new Set([
  "agent.attention",
  "agent.turn-finished",
]);

/**
 * 消息中心 toast 预览桥（agent 类消息前台 toast 预览）。
 * 只预览不经 systemNotify 门面的 kind（agent.attention / agent.turn-finished）：
 * 门面消息已本地 toast，经 NCS 广播回来不得重复弹。
 * 窗口未聚焦时 toast 按时长自然过期，OS 通知是彼场景的通道（agent-attention 发送）。
 */
export function NotificationToastPreviewBridge(): null {
  useEffect(() => {
    let detach: (() => void) | null = null;
    let cancelled = false;
    // 水合完成后才灌 seen 并订阅，不回放历史。水合前抢先到达的广播本就包含在
    // main 快照里，水合 resolve 时无法与历史区分，一律按历史 prime（已进 inbox）。
    // seen 按 id → repeatCount 判定：dedupe 合并保留原 id 但 repeatCount+1，
    // 窗口内重复事件（同一 agent 再次需要注意）仍重新弹预览。
    notificationCenterHydration
      .then(() => {
        if (cancelled) {
          return;
        }
        const seen = new Map<string, number>();
        for (const item of useNotificationCenterStore.getState().items) {
          seen.set(item.id, item.repeatCount ?? 0);
        }
        detach = useNotificationCenterStore.subscribe((state) => {
          for (const item of state.items) {
            const repeatCount = item.repeatCount ?? 0;
            const prev = seen.get(item.id);
            if (prev !== undefined && prev >= repeatCount) {
              continue;
            }
            seen.set(item.id, repeatCount);
            if (!PREVIEW_KINDS.has(item.kind) || item.read) {
              continue;
            }
            const decision = routeDelivery(
              { kind: item.kind, severity: item.severity },
              {
                dndEnabled: state.dndEnabled,
                mutedKinds:
                  useNotificationCenterPrefsStore.getState().prefs.mutedKinds,
              }
            );
            if (decision.toast) {
              showNotificationToast(item);
            }
          }
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
  return null;
}
