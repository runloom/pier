/**
 * Pure-math Codex usage display helpers.
 * Renderer-side label assembly (formatDurationShort, etc.) goes in usage-meter.tsx.
 */

/**
 * Returns remaining percentage clamped [0, 100], rounded to integer.
 *   usedPercent=32  → 68
 *   usedPercent=0   → 100
 *   usedPercent=150 → 0
 */
export function remainingPercent(usedPercent: number): number {
  const remaining = 100 - usedPercent;
  if (remaining <= 0) return 0;
  if (remaining >= 100) return 100;
  return Math.round(remaining);
}

export type UsageRisk = "critical" | "normal" | "warning";

/** 配额风险基于已使用比例：75% 开始提醒，90% 进入紧张状态。 */
export function usageRisk(usedPercent: number): UsageRisk {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  return "normal";
}

/** 返回适合进度条展示的已使用整数百分比。 */
export function normalizedUsedPercent(usedPercent: number): number {
  if (usedPercent <= 0) return 0;
  if (usedPercent >= 100) return 100;
  return Math.round(usedPercent);
}
