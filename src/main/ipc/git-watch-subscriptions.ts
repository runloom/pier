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

export interface GitWatchSubscriptions {
  /** 丢弃某 webContents 的全部订阅（无视计数，webContents 销毁时用）。 */
  dropAll(wcId: number): void;
  /** 递增 (wcId, gitRoot) 计数；首个引用时调用 subscribe 建立底层订阅。 */
  start(wcId: number, gitRoot: string, subscribe: () => () => void): void;
  /** 递减计数；归零时销毁底层订阅。未订阅时为 no-op。 */
  stop(wcId: number, gitRoot: string): void;
}

export function createGitWatchSubscriptions(): GitWatchSubscriptions {
  const byWc = new Map<number, Map<string, SubscriptionEntry>>();

  return {
    dropAll(wcId) {
      const roots = byWc.get(wcId);
      if (!roots) {
        return;
      }
      byWc.delete(wcId);
      for (const entry of roots.values()) {
        entry.dispose();
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
        existing.count += 1;
        return;
      }
      roots.set(gitRoot, { count: 1, dispose: subscribe() });
    },
    stop(wcId, gitRoot) {
      const roots = byWc.get(wcId);
      const entry = roots?.get(gitRoot);
      if (!(roots && entry)) {
        return;
      }
      entry.count -= 1;
      if (entry.count > 0) {
        return;
      }
      roots.delete(gitRoot);
      if (roots.size === 0) {
        byWc.delete(wcId);
      }
      entry.dispose();
    },
  };
}
