/**
 * LRU 淘汰与数组裁剪辅助。
 *
 * 各 state 模块统一使用这些函数做容量限制。
 */

/**
 * 从 Map 中逐出最旧条目直到 size <= limit。
 *
 * @param map    待裁剪的 Map（原地修改）
 * @param limit  允许的最大条目数
 * @param keyOf  从 value 中提取排序指标（越小 = 越旧）
 * @returns 被逐出的 key 列表
 */
export function pruneToLimit<K, V>(
  map: Map<K, V>,
  limit: number,
  keyOf: (v: V) => number
): K[] {
  const evicted: K[] = [];
  while (map.size > limit) {
    let oldestKey: K | undefined;
    let oldestOrd = Number.POSITIVE_INFINITY;
    for (const [k, v] of map) {
      const ord = keyOf(v);
      if (ord < oldestOrd) {
        oldestOrd = ord;
        oldestKey = k;
      }
    }
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
    evicted.push(oldestKey);
  }
  return evicted;
}

/**
 * 返回数组的前 limit 个元素（浅拷贝）。
 *
 * limit <= 0 返回空数组；limit >= arr.length 返回完整浅拷贝。
 */
export function pruneArray<T>(arr: readonly T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }
  return arr.slice(0, limit);
}
