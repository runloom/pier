/**
 * 滑动窗口限速（内存态，重启归零可接受——服务端设计 §3/§8）。
 * 语义：`hit` 记一次并判断是否仍在限额内；窗口过期即弃，无 IP 归档（§9 隐私红线）。
 */

export interface SlidingWindowLimiter {
  /** 记一次；返回 false 表示超限（本次不放行）。 */
  hit(key: string): boolean;
  /** 只判不记（连接级持续检查用）。 */
  wouldExceed(key: string): boolean;
}

export function createSlidingWindowLimiter(args: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): SlidingWindowLimiter {
  const now = args.now ?? Date.now;
  const hitsByKey = new Map<string, number[]>();

  function prune(key: string): number[] {
    const cutoff = now() - args.windowMs;
    const hits = (hitsByKey.get(key) ?? []).filter((ts) => ts > cutoff);
    if (hits.length === 0) {
      hitsByKey.delete(key);
    } else {
      hitsByKey.set(key, hits);
    }
    return hits;
  }

  return {
    hit(key: string): boolean {
      const hits = prune(key);
      if (hits.length >= args.limit) {
        return false;
      }
      hits.push(now());
      hitsByKey.set(key, hits);
      return true;
    },
    wouldExceed(key: string): boolean {
      return prune(key).length >= args.limit;
    },
  };
}
