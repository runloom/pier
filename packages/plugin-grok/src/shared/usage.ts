/**
 * Pure-math Grok usage display helpers.
 * Renderer-side label assembly goes in usage-meter.tsx.
 */

export function remainingPercent(usedPercent: number): number {
  const remaining = 100 - usedPercent;
  if (remaining <= 0) return 0;
  if (remaining >= 100) return 100;
  return Math.round(remaining);
}

export type UsageRisk = "critical" | "normal" | "warning";

/** Risk from used percent: warn at 75%, critical at 90%. */
export function usageRisk(usedPercent: number): UsageRisk {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  return "normal";
}

export function normalizedUsedPercent(usedPercent: number): number {
  if (usedPercent <= 0) return 0;
  if (usedPercent >= 100) return 100;
  return Math.round(usedPercent);
}
