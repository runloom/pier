import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";

/**
 * Agent 状态栏 item 的视觉纯逻辑（对齐 loomdesk 终端状态栏 activity item）：
 * - 五态文案 key（ready 可见 = "等待输入"）
 * - shimmer 门控（仅 processing/tool, loomdesk SHIMMERING_AGENT_STATUSES）
 * - 状态色 CSS 变量（loomdesk AGENT_STATUS_PULSE + 长跑覆盖仅 running）
 * - OMP classic 扫带的逐字符 tier 计算（loomdesk shimmering-status-text 同源算法）
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

export type ShimmerTier = "high" | "low" | "mid";

// OMP classic 扫带：略放慢速度、加宽亮带，短中文状态词也能看出完整扫过。
const SHIMMER_SPEED_CELLS_PER_S = 22;
const CLASSIC_PADDING = 8;
const CLASSIC_BAND_HALF_WIDTH = 5;
const TIER_HIGH = 0.55;
const TIER_MID = 0.18;
export const SHIMMER_MIN_CYCLE_MS = 1200;
export const SHIMMER_FRAME_INTERVAL_MS = 1000 / 30;

/**
 * 逐字符 tier：余弦亮带从左到右扫过（带 padding 让亮带完整滑入滑出），
 * intensity >=0.65 high（状态色+加粗）、>=0.22 mid、否则 low。
 */
export function shimmerTiers(text: string, elapsedMs: number): ShimmerTier[] {
  const chars = Array.from(text);
  const len = chars.length;
  if (len === 0) {
    return [];
  }
  const scale = Math.min(1, len / (2 * CLASSIC_BAND_HALF_WIDTH));
  const halfWidth = CLASSIC_BAND_HALF_WIDTH * scale;
  const padding = CLASSIC_PADDING * scale;
  const period = len + 2 * padding;
  const naturalCycleMs = (period * 1000) / SHIMMER_SPEED_CELLS_PER_S;
  const cycleMs = Math.max(SHIMMER_MIN_CYCLE_MS, naturalCycleMs);
  const elapsed = Math.max(0, elapsedMs);
  const pos = ((elapsed / cycleMs) * period) % period;
  return chars.map((_char, index) => {
    const dist = Math.abs(index + padding - pos);
    const intensity =
      dist < halfWidth ? 0.5 * (1 + Math.cos((Math.PI * dist) / halfWidth)) : 0;
    if (intensity >= TIER_HIGH) {
      return "high";
    }
    if (intensity >= TIER_MID) {
      return "mid";
    }
    return "low";
  });
}
