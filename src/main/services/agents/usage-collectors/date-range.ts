/**
 * 共享日期区间工具。UTC 语义：所有 collector 都以 `YYYY-MM-DD` UTC 日为桶。
 * publish 前必须用当前 coverage 再裁一次——缓存复用会带回滑动窗口外的旧观测。
 */

export function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function filterByCoverageDate<T extends { date: string }>(
  items: readonly T[],
  from: string,
  to: string
): T[] {
  return items.filter((item) => item.date >= from && item.date <= to);
}
