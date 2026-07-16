/**
 * git watch 订阅的 (webContentsId, gitRoot) 引用计数注册表。
 *
 * 同一窗口内多个消费方（每个终端面板的状态栏 item + 变更面板）会对同一 gitRoot
 * 各自 start/stop。底层 watch-service 订阅必须在"最后一个引用退订"时才销毁，
 * 否则任一面板 unmount 就会杀死共享订阅，其余消费方的 git 状态永久冻结
 * （renderer 侧只靠广播驱动刷新，没有兜底轮询）。
 *
 * 独立成模块（不 import electron）以便 vitest 直测计数语义。
 */

interface SubscriptionEntry {
  count: number;
  dispose: () => void;
}

interface GitWatchSubscriptions {
  /** 丢弃某 webContents 的全部订阅（无视计数，webContents 销毁时用）。 */
  dropAll(wcId: number): void;
  /** 递增 (wcId, gitRoot) 计数；首个引用时调用 subscribe 建立底层订阅。 */
  start(wcId: number, gitRoot: string, subscribe: () => () => void): boolean;
  /** 递减计数；归零时销毁底层订阅。未订阅时为 no-op。 */
  stop(wcId: number, gitRoot: string): boolean;
}

const GIT_WATCH_MAX_ROOTS_PER_WEB_CONTENTS = 16;
const GIT_WATCH_MAX_ACTIVE_ROOTS = 64;
export const GIT_WATCH_MAX_REFERENCES_PER_ROOT = 32;

export function createGitWatchSubscriptions(
  limits: {
    readonly maxActiveRoots?: number;
    readonly maxReferencesPerRoot?: number;
    readonly maxRootsPerWebContents?: number;
  } = {}
): GitWatchSubscriptions {
  const byWc = new Map<number, Map<string, SubscriptionEntry>>();
  const rootSubscribers = new Map<string, number>();
  const maxActiveRoots = limits.maxActiveRoots ?? GIT_WATCH_MAX_ACTIVE_ROOTS;
  const maxReferencesPerRoot =
    limits.maxReferencesPerRoot ?? GIT_WATCH_MAX_REFERENCES_PER_ROOT;
  const maxRootsPerWebContents =
    limits.maxRootsPerWebContents ?? GIT_WATCH_MAX_ROOTS_PER_WEB_CONTENTS;

  const releaseRoot = (gitRoot: string): void => {
    const subscribers = rootSubscribers.get(gitRoot) ?? 0;
    if (subscribers <= 1) {
      rootSubscribers.delete(gitRoot);
    } else {
      rootSubscribers.set(gitRoot, subscribers - 1);
    }
  };

  return {
    dropAll(wcId) {
      const roots = byWc.get(wcId);
      if (!roots) {
        return;
      }
      byWc.delete(wcId);
      for (const [gitRoot, entry] of roots) {
        releaseRoot(gitRoot);
        try {
          entry.dispose();
        } catch {
          // 一个底层 disposer 失败不能阻断其余 root 的确定性释放。
        }
      }
    },
    start(wcId, gitRoot, subscribe) {
      let roots = byWc.get(wcId);
      if (!roots) {
        roots = new Map();
        byWc.set(wcId, roots);
      }
      const existing = roots.get(gitRoot);
      if (existing) {
        if (existing.count >= maxReferencesPerRoot) {
          return false;
        }
        existing.count += 1;
        return true;
      }
      if (
        roots.size >= maxRootsPerWebContents ||
        (!rootSubscribers.has(gitRoot) &&
          rootSubscribers.size >= maxActiveRoots)
      ) {
        if (roots.size === 0) {
          byWc.delete(wcId);
        }
        return false;
      }
      let dispose: () => void;
      try {
        dispose = subscribe();
      } catch {
        if (roots.size === 0) {
          byWc.delete(wcId);
        }
        return false;
      }
      roots.set(gitRoot, { count: 1, dispose });
      rootSubscribers.set(gitRoot, (rootSubscribers.get(gitRoot) ?? 0) + 1);
      return true;
    },
    stop(wcId, gitRoot) {
      const roots = byWc.get(wcId);
      const entry = roots?.get(gitRoot);
      if (!(roots && entry)) {
        return false;
      }
      entry.count -= 1;
      if (entry.count > 0) {
        return true;
      }
      roots.delete(gitRoot);
      releaseRoot(gitRoot);
      if (roots.size === 0) {
        byWc.delete(wcId);
      }
      try {
        entry.dispose();
      } catch {
        // 注册表已经完成释放；异常不得复活租约或破坏幂等 STOP。
      }
      return true;
    },
  };
}
