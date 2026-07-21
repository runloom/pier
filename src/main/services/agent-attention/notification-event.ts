import type { AgentAttentionSettings } from "@shared/contracts/agent-attention.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";

export type AgentNotificationEventKind = "waiting" | "ready" | "error";

/** 注意力触发集 T：waiting 恒在；error 仅当 enableErrorAttention。 */
function inAttentionTriggerSet(
  status: ActivityStatus | undefined,
  settings: Pick<AgentAttentionSettings, "enableErrorAttention">
): boolean {
  if (status === "waiting") {
    return true;
  }
  return settings.enableErrorAttention && status === "error";
}

/**
 * 将 FA 状态边沿分类为可投递通知事件；不负责聚焦抑制。
 * ready 与注意力 T 解耦；enabled 只约束 waiting；enableErrorAttention 只约束 error。
 */
export function classifyAgentNotificationEvent(args: {
  previous: ActivityStatus | undefined;
  next: ActivityStatus | undefined;
  settings: Pick<
    AgentAttentionSettings,
    "enabled" | "enableErrorAttention" | "turnNotifyMode"
  >;
}): AgentNotificationEventKind | null {
  const { previous, next, settings } = args;

  // ready 独立：回合结束边沿，且 turnNotifyMode ≠ off。
  // previous === undefined 是「面板首次投影」（SessionStart 消抖揭示、
  // app 启动/重连后首个快照），FA 新建层初始即 ready——没有跑过回合，
  // 不得当成回合完成通知。
  if (
    next === "ready" &&
    previous !== undefined &&
    previous !== "ready" &&
    settings.turnNotifyMode !== "off"
  ) {
    return "ready";
  }

  // waiting / error：仅 previous ∉ T 且 next ∈ T 的进入边。
  if (
    !inAttentionTriggerSet(previous, settings) &&
    inAttentionTriggerSet(next, settings)
  ) {
    if (next === "waiting") {
      return settings.enabled ? "waiting" : null;
    }
    if (next === "error") {
      return "error";
    }
  }

  return null;
}

/**
 * 聚焦抑制：ready 看拥有窗口 + turnNotifyMode；waiting/error 看目标 panel + suppressWhenFocused。
 */
export function shouldSuppressAgentNotification(args: {
  kind: AgentNotificationEventKind;
  settings: Pick<
    AgentAttentionSettings,
    "suppressWhenFocused" | "turnNotifyMode"
  >;
  isTargetPanelFocused: boolean;
  isOwnerWindowFocused: boolean;
}): boolean {
  const { kind, settings, isTargetPanelFocused, isOwnerWindowFocused } = args;

  if (kind === "ready") {
    if (settings.turnNotifyMode === "always") {
      return false;
    }
    if (settings.turnNotifyMode === "unfocused") {
      return isOwnerWindowFocused;
    }
    // off 应由 classify 滤掉；保守抑制。
    return true;
  }

  return settings.suppressWhenFocused && isTargetPanelFocused;
}
