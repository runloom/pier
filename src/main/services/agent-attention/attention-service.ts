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
  type AttentionUiLocale,
  formatAttentionNotificationCopy,
} from "./notification-copy.ts";

const log = createLogger("agent-attention");

export interface AgentAttentionService {
  /** 测试 / 诊断：某 agentRef 最近一次尝试通知的时刻。 */
  lastNotifiedAt(agentRef: string): number | undefined;
  observe(
    previous: ForegroundActivityBroadcast | null,
    next: ForegroundActivityBroadcast
  ): Promise<void>;
}

export interface CreateAgentAttentionServiceArgs {
  isTargetPanelFocused(electronWindowId: string, panelId: string): boolean;
  now?(): number;
  resolveLocale?(): AttentionUiLocale | Promise<AttentionUiLocale>;
  settings?(): AgentAttentionSettings;
  showNotification(
    request: SystemNotificationRequest
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

function shouldTriggerForStatus(
  status: ActivityStatus | undefined,
  settings: AgentAttentionSettings
): boolean {
  if (status === "waiting") {
    return true;
  }
  return settings.enableErrorAttention && status === "error";
}

function enteredAttention(
  previous: ActivityStatus | undefined,
  next: ActivityStatus | undefined,
  settings: AgentAttentionSettings
): boolean {
  if (!shouldTriggerForStatus(next, settings)) {
    return false;
  }
  return previous !== next;
}

export function createAgentAttentionService({
  isTargetPanelFocused,
  now = () => Date.now(),
  resolveLocale = () => "en" as AttentionUiLocale,
  settings = () => DEFAULT_AGENT_ATTENTION_SETTINGS,
  showNotification,
}: CreateAgentAttentionServiceArgs): AgentAttentionService {
  const lastNotified = new Map<string, number>();

  return {
    lastNotifiedAt(agentRef) {
      return lastNotified.get(agentRef);
    },
    async observe(previous, next) {
      const prefs = settings();
      const prevMap = previous
        ? agentStatusMap(previous.activities)
        : new Map<string, ActivityStatus | undefined>();
      const locale = await resolveLocale();

      for (const activity of next.activities) {
        if (activity.kind !== "agent") {
          continue;
        }
        const agentRef = makeAgentRef(activity.windowId, activity.panelId);
        const prevStatus = prevMap.get(agentRef);
        if (!enteredAttention(prevStatus, activity.status, prefs)) {
          continue;
        }

        if (isTargetPanelFocused(activity.windowId, activity.panelId)) {
          log.debug("skip notify: target panel focused", { agentRef });
          continue;
        }

        const lastAt = lastNotified.get(agentRef);
        const ts = now();
        if (lastAt !== undefined && ts - lastAt < prefs.cooldownMs) {
          log.debug("skip notify: cooldown", { agentRef });
          continue;
        }

        const copy = formatAttentionNotificationCopy(activity, locale);
        const tag = `${AGENT_ATTENTION_KIND}:${agentRef}`;
        const result = await showNotification({
          agentRef,
          body: copy.body,
          kind: AGENT_ATTENTION_KIND,
          tag,
          title: copy.title,
        });

        // 仅在真正展示后记冷却；shown:false 不得冒充已通知。
        if (result.shown) {
          lastNotified.set(agentRef, ts);
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
