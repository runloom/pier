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
