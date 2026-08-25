import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";

/**
 * Agent 状态栏 item：五态文案 key 与 shimmer 门控（仅 processing/tool）。
 * 扫光动画在 globals.css [data-agent-status-text]。
 */

export type AgentStatusTextKey =
  | "terminal.agentStatus.error"
  | "terminal.agentStatus.processing"
  | "terminal.agentStatus.ready"
  | "terminal.agentStatus.tool"
  | "terminal.agentStatus.waiting";

/** 状态 → i18n 文案 key。五态齐备——loomdesk 的 ready 同样可见（"等待输入"）。 */
export function agentStatusTextKey(status: ActivityStatus): AgentStatusTextKey {
  switch (status) {
    case "processing":
      return "terminal.agentStatus.processing";
    case "tool":
      return "terminal.agentStatus.tool";
    case "waiting":
      return "terminal.agentStatus.waiting";
    case "error":
      return "terminal.agentStatus.error";
    default:
      return "terminal.agentStatus.ready";
  }
}

/** shimmer 仅活跃推进态（loomdesk SHIMMERING_AGENT_STATUSES = processing/tool）。 */
export function shouldShimmer(status: ActivityStatus): boolean {
  return status === "processing" || status === "tool";
}
