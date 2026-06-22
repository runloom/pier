/**
 * 订阅 + 版本号公共基础, 供 actionRegistry / keybindingRegistry 等 versioned
 * store 复用. 设计目标:
 *
 *   - subscribe(cb) → 返回 unsubscribe; 多 subscriber 之间隔离, 一个 listener 抛错
 *     不影响其他 listener (try/catch 单点失败).
 *   - getVersion() 单调递增, 作为 useSyncExternalStore 的 snapshot 触发器.
 *   - notify() 受保护方法, 仅子类 / 同模块调用.
 */
export class Notifier {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  protected notify(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[Notifier] listener threw:", err);
      }
    }
  }
}
