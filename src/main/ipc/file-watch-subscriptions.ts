/**
 * file watch 订阅的 (webContentsId, root) 引用计数注册表。
 * 语义与 git-watch-subscriptions 对齐。
 */

interface SubscriptionEntry {
  count: number;
  dispose: () => void;
}

export interface FileWatchSubscriptions {
  dropAll(wcId: number): void;
  start(wcId: number, root: string, subscribe: () => () => void): void;
  stop(wcId: number, root: string): void;
}

export function createFileWatchSubscriptions(): FileWatchSubscriptions {
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
    start(wcId, root, subscribe) {
      let roots = byWc.get(wcId);
      if (!roots) {
        roots = new Map();
        byWc.set(wcId, roots);
      }
      const existing = roots.get(root);
      if (existing) {
        existing.count += 1;
        return;
      }
      roots.set(root, { count: 1, dispose: subscribe() });
    },
    stop(wcId, root) {
      const roots = byWc.get(wcId);
      const entry = roots?.get(root);
      if (!(roots && entry)) {
        return;
      }
      entry.count -= 1;
      if (entry.count > 0) {
        return;
      }
      roots.delete(root);
      if (roots.size === 0) {
        byWc.delete(wcId);
      }
      entry.dispose();
    },
  };
}
