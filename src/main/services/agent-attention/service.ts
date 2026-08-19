/**
 * Agent Attention：FA 边沿分类 → 消息中心 ingest。
 *
 * 打断投递（形态 B toast / OS / 声音）由 NCS DeliveryPlan 统一调度；
 * 本服务不调用 OS API，不做 focus 抑制吞档、不做 OS 冷却。
 */
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent/attention.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import {
  type AttentionLocationContext,
  type AttentionUiLocale,
  formatAttentionNotificationCopy,
} from "./notification-copy.ts";
import {
  type AgentNotificationEventKind,
  classifyAgentNotificationEvent,
} from "./notification-event.ts";

export interface AgentAttentionService {
  observe(
    previous: ForegroundActivityBroadcast | null,
    next: ForegroundActivityBroadcast
  ): Promise<void>;
}

export interface CreateAgentAttentionServiceArgs {
  /** 同步投递到消息中心（NCS）。 */
  ingestNotification: (report: NotificationReport) => void;
  resolveLocale?(): AttentionUiLocale | Promise<AttentionUiLocale>;
  /**
   * 尽力解析路径锚点（项目根 / cwd），供通知 body 区分多实例。
   * 失败或缺席时仅用 agent 品牌 + sessionTitle。
   */
  resolveLocation?(args: {
    agentRef: string;
    panelId: string;
    windowId: string;
  }): AttentionLocationContext | null | undefined;
  /** 同步读取当前策略（main 缓存）；禁止在此做异步 IO。 */
  settings?(): AgentAttentionSettings;
}

type AgentStatusMap = Map<string, ActivityStatus | undefined>;

function inboxSeverityFor(
  kind: AgentNotificationEventKind
): "error" | "info" | "warning" {
  if (kind === "error") {
    return "error";
  }
  return kind === "waiting" ? "warning" : "info";
}

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
  ingestNotification,
  resolveLocale = () => "en" as AttentionUiLocale,
  settings = () => DEFAULT_AGENT_ATTENTION_SETTINGS,
  resolveLocation,
}: CreateAgentAttentionServiceArgs): AgentAttentionService {
  return {
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
        const kind = classifyAgentNotificationEvent({
          previous: prevStatus,
          next: activity.status,
          settings: prefs,
        });
        if (kind == null) {
          continue;
        }

        const location =
          resolveLocation?.({
            agentRef,
            panelId: activity.panelId,
            windowId: activity.windowId,
          }) ?? null;
        const copy = formatAttentionNotificationCopy(
          activity,
          locale,
          location
        );

        ingestNotification({
          actionParams: { agentRef },
          actions: [
            {
              id: "focus-panel",
              labelKey: copy.actionLabelKey,
            },
          ],
          agentRef,
          body: copy.body,
          dedupeKey:
            kind === "ready"
              ? `agent.turn-finished:${agentRef}`
              : `agent.attention:${kind}:${agentRef}`,
          kind: kind === "ready" ? "agent.turn-finished" : "agent.attention",
          panelRef: { panelId: activity.panelId },
          severity: inboxSeverityFor(kind),
          source: "agent-attention",
          title: copy.title,
          titleKey: copy.titleKey,
          trigger: "system-event",
        });
      }
    },
  };
}
