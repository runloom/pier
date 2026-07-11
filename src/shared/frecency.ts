export const FRECENCY_HALF_LIFE_DAYS = 14;
export const MILLISECONDS_PER_DAY = 86_400_000;

export interface FrecencyEntry {
  lastUsedAt: number;
  useCount: number;
}

/** 使用次数随时间指数衰减，避免陈旧高频记录长期霸榜。 */
export function usageFrecency(entry: FrecencyEntry, now: number): number {
  const ageDays = (now - entry.lastUsedAt) / MILLISECONDS_PER_DAY;
  return entry.useCount * 0.5 ** (ageDays / FRECENCY_HALF_LIFE_DAYS);
}
