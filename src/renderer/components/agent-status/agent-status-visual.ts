import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";

/**
 * Agent 状态栏 item 的视觉纯逻辑（对齐 loomdesk 终端状态栏 activity item）：
 * - 五态文案 key（ready 可见 = "等待输入"）
 * - shimmer 门控（仅 processing/tool, loomdesk SHIMMERING_AGENT_STATUSES）
 * - 状态色 CSS 变量（loomdesk AGENT_STATUS_PULSE + 长跑覆盖仅 running）
 * shimmer 动画本体是纯 CSS 渐变扫光（globals.css [data-agent-status-text] 段）,
 * 此处只输出门控与颜色语义。
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export type LongRunLevel = "warn" | "danger" | null;

/** running 态长跑警示：>=5min 琥珀, >=30min 红（loomdesk visual-status.ts）。 */
export function longRunLevel(elapsedMs: number): LongRunLevel {
  if (elapsedMs >= THIRTY_MINUTES_MS) {
    return "danger";
  }
  if (elapsedMs >= FIVE_MINUTES_MS) {
    return "warn";
  }
  return null;
}

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

/**
 * 状态 → 状态色 CSS 变量名（loomdesk AGENT_STATUS_PULSE）。
 * 长跑覆盖只对 running（processing/tool）生效, 消费点是 shimmer 高档色。
 */
export function statusColorVar(
  status: ActivityStatus,
  level: LongRunLevel
): string {
  if (shouldShimmer(status)) {
    if (level === "danger") {
      return "--status-danger-fg";
    }
    if (level === "warn") {
      return "--status-warning-fg";
    }
    // processing=思考中用 info；tool=执行工具用 done，扫带高档色可辨。
    return status === "tool" ? "--status-done-fg" : "--status-info-fg";
  }
  if (status === "waiting") {
    return "--status-warning-fg";
  }
  if (status === "error") {
    return "--status-danger-fg";
  }
  return "--foreground";
}
