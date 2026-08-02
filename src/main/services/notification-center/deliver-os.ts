/**
 * NCS → OS 系统通知适配：AppNotification 映射 + 音频 + click 深链。
 * 业务策略（是否发 OS）已由 resolveDeliveryPlan 决定；本模块只执行。
 *
 * `index` 可选：未绑定 runtime index 时仍展示横幅；有 agentRef 时深链降级跳过。
 */
import {
  decideNotificationAudio,
  maybePlayAfterShown,
} from "@main/services/agent-attention/notification-audio.ts";
import { focusAgentFromNotificationClick } from "@main/services/agent-attention/notification-click-focus.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { showSystemNotification } from "@main/services/system-notification.ts";
import {
  AGENT_ATTENTION_KIND,
  type AgentAttentionSettings,
} from "@shared/contracts/agent/attention.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { createLogger } from "@shared/logger.ts";
import {
  broadcastAgentAttentionDegraded,
  broadcastSystemNotificationPermissionChanged,
  sendAttentionSoundPlayToOneWindow,
} from "../../app-core/window-broadcasts.ts";

const log = createLogger("notification-center.deliver-os");

export interface CreateDeliverOsArgs {
  getAttentionSettings: () => AgentAttentionSettings;
  /** 运行时读取；可为 null（启动竞态 / 测试）。深链在无 index 时跳过。 */
  getIndex?: () => AgentRuntimeIndexService | null;
  /** @deprecated 优先 getIndex；静态注入兼容旧调用。 */
  index?: AgentRuntimeIndexService | null;
  /** 可选：点击时按 dedupeKey 标已读。 */
  markReadByDedupeKey?: (dedupeKey: string) => void;
}

let degradedBroadcasted = false;

export function resetDeliverOsDegradedLatchForTests(): void {
  degradedBroadcasted = false;
}

function resolveIndex(
  args: CreateDeliverOsArgs
): AgentRuntimeIndexService | null {
  if (args.getIndex) {
    return args.getIndex();
  }
  return args.index ?? null;
}

export function createDeliverOs(args: CreateDeliverOsArgs) {
  return async (
    notification: AppNotification,
    _meta: { cooldownKey?: string }
  ): Promise<boolean> => {
    const settings = args.getAttentionSettings();
    const audioDecision = decideNotificationAudio(settings);
    const kindForOs =
      notification.kind === "agent.turn-finished" ||
      notification.kind === "agent.attention"
        ? AGENT_ATTENTION_KIND
        : notification.kind;
    const tag =
      notification.agentRef != null && notification.agentRef.length > 0
        ? `${kindForOs}:${notification.agentRef}`
        : `${kindForOs}:${notification.id}`;

    try {
      const result = await showSystemNotification(
        {
          title: notification.title,
          ...(notification.body ? { body: notification.body } : {}),
          kind: kindForOs,
          tag,
          ...(notification.agentRef ? { agentRef: notification.agentRef } : {}),
        },
        {
          silent: audioDecision.silent,
          ...(audioDecision.sound === undefined
            ? {}
            : { sound: audioDecision.sound }),
          onClick: async (shown) => {
            if (notification.dedupeKey && args.markReadByDedupeKey) {
              args.markReadByDedupeKey(notification.dedupeKey);
            }
            const index = resolveIndex(args);
            if (!index) {
              if (shown.agentRef) {
                log.warn("os click: runtime index unbound; skip deep-link", {
                  agentRef: shown.agentRef,
                });
              }
              return;
            }
            await focusAgentFromNotificationClick(index, shown);
          },
          onPermissionChanged: (snapshot) => {
            if (snapshot.status === "authorized") {
              degradedBroadcasted = false;
            }
            broadcastSystemNotificationPermissionChanged(snapshot);
          },
          onUnavailable: (reason) => {
            if (reason !== "denied" && reason !== "unsupported") {
              return;
            }
            if (degradedBroadcasted) {
              return;
            }
            degradedBroadcasted = true;
            broadcastAgentAttentionDegraded({ reason });
          },
        }
      );

      if (result.shown) {
        maybePlayAfterShown({
          decision: audioDecision,
          force: false,
          sendToWindow: sendAttentionSoundPlayToOneWindow,
        });
      } else {
        log.debug("os notification not shown", {
          kind: notification.kind,
          reason: result.reason,
        });
      }
      return result.shown;
    } catch (err) {
      log.warn("os notification failed", { err });
      return false;
    }
  };
}
