import {
  AGENT_ATTENTION_KIND,
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import { createLogger } from "@shared/logger.ts";
import {
  decideNotificationAudio,
  type NotificationAudioDecision,
  toShowAudio,
} from "./notification-audio.ts";
import {
  type AttentionUiLocale,
  formatAttentionNotificationCopy,
} from "./notification-copy.ts";
import {
  type AgentNotificationEventKind,
  classifyAgentNotificationEvent,
  shouldSuppressAgentNotification,
} from "./notification-event.ts";

const log = createLogger("agent-attention");

export interface AgentAttentionService {
  /** 测试 / 诊断：某 agentRef 某类事件最近一次成功通知的时刻。 */
  lastNotifiedAt(
    agentRef: string,
    kind: AgentNotificationEventKind
  ): number | undefined;
  observe(
    previous: ForegroundActivityBroadcast | null,
    next: ForegroundActivityBroadcast
  ): Promise<void>;
}

export interface CreateAgentAttentionServiceArgs {
  /** 拥有该智能体面板的 BrowserWindow 是否聚焦（ready / unfocused 模式）。 */
  isOwnerWindowFocused(electronWindowId: string): boolean;
  isTargetPanelFocused(electronWindowId: string, panelId: string): boolean;
  now?(): number;
  /**
   * shown:true 后调用。默认 maybePlayAfterShown（业务 force:false）。
   * 单测可注入以断言播音决策，不依赖 windowManager。
   */
  playAttentionSound?: (decision: NotificationAudioDecision) => void;
  resolveLocale?(): AttentionUiLocale | Promise<AttentionUiLocale>;
  /** 同步读取当前策略（main 缓存）；禁止在此做异步 IO。 */
  settings?(): AgentAttentionSettings;
  showNotification(
    request: SystemNotificationRequest,
    audio?: Pick<NotificationAudioDecision, "silent" | "sound">
  ): SystemNotificationResult | Promise<SystemNotificationResult>;
}

type AgentStatusMap = Map<string, ActivityStatus | undefined>;

function agentStatusMap(
  activities: readonly ForegroundActivity[]
): AgentStatusMap {
  const map: AgentStatusMap = new Map();
  for (const activity of activities) {
    if (activity.kind !== "agent") {
      continue;
    }
    map.set(makeAgentRef(activity.windowId, activity.panelId), activity.status);
  }
  return map;
}

export function createAgentAttentionService({
  isTargetPanelFocused,
  isOwnerWindowFocused,
  now = () => Date.now(),
  resolveLocale = () => "en" as AttentionUiLocale,
  settings = () => DEFAULT_AGENT_ATTENTION_SETTINGS,
  showNotification,
  playAttentionSound = (_decision) => {
    // 默认无播音端口：生产由 registerAgentAttention 注入 sendToWindow 单播。
    // 未注入时静默 no-op，避免单测/集成路径误以为已播。
  },
}: CreateAgentAttentionServiceArgs): AgentAttentionService {
  // 冷却按 (kind, agentRef) 分开记：waiting 通知不得吞掉随后的回合完成，
  // 连续短回合的 ready 之间才互相受 cooldownMs 约束。
  const lastNotified = new Map<string, number>();
  const cooldownKey = (
    agentRef: string,
    kind: AgentNotificationEventKind
  ): string => `${kind}:${agentRef}`;

  return {
    lastNotifiedAt(agentRef, kind) {
      return lastNotified.get(cooldownKey(agentRef, kind));
    },
    async observe(previous, next) {
      const prefs = settings();
      // 禁止整次 observe 因 enabled=false 短路：ready / error 可独立于 enabled。

      const prevMap = previous
        ? agentStatusMap(previous.activities)
        : new Map<string, ActivityStatus | undefined>();
      const locale = await resolveLocale();

      // 冷却回收：面板消失（关闭 / 会话结束）即清理，防长跑进程只增不减。
      // 重开面板视为新会话，重新计冷却。
      const liveRefs = agentStatusMap(next.activities);
      for (const key of lastNotified.keys()) {
        const agentRef = key.slice(key.indexOf(":") + 1);
        if (!liveRefs.has(agentRef)) {
          lastNotified.delete(key);
        }
      }

      for (const activity of next.activities) {
        if (activity.kind !== "agent") {
          continue;
        }
        const agentRef = makeAgentRef(activity.windowId, activity.panelId);
        const prevStatus = prevMap.get(agentRef);
        const kind = classifyAgentNotificationEvent({
          previous: prevStatus,
          next: activity.status,
          settings: prefs,
        });
        if (kind == null) {
          continue;
        }

        if (
          shouldSuppressAgentNotification({
            kind,
            settings: prefs,
            isTargetPanelFocused: isTargetPanelFocused(
              activity.windowId,
              activity.panelId
            ),
            isOwnerWindowFocused: isOwnerWindowFocused(activity.windowId),
          })
        ) {
          log.debug("skip notify: suppressed by focus", { agentRef, kind });
          continue;
        }

        const lastAt = lastNotified.get(cooldownKey(agentRef, kind));
        const ts = now();
        if (lastAt !== undefined && ts - lastAt < prefs.cooldownMs) {
          log.debug("skip notify: cooldown", { agentRef, kind });
          continue;
        }

        const copy = formatAttentionNotificationCopy(activity, locale);
        const tag = `${AGENT_ATTENTION_KIND}:${agentRef}`;
        const decision = decideNotificationAudio(prefs);
        const audio = toShowAudio(decision);
        const result = await showNotification(
          {
            agentRef,
            body: copy.body,
            kind: AGENT_ATTENTION_KIND,
            tag,
            title: copy.title,
          },
          audio
        );

        // 仅在真正展示后记冷却；shown:false 不得冒充已通知。
        if (result.shown) {
          lastNotified.set(cooldownKey(agentRef, kind), ts);
          playAttentionSound(decision);
        } else {
          log.debug("notification not shown", {
            agentRef,
            reason: result.reason,
          });
        }
      }
    },
  };
}
