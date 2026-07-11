export interface ExternalRendererActivationScope {
  add(dispose: () => void): () => void;
  dispose(): void;
}

/**
 * 宿主持有的外部插件激活事务。插件在 activate 期间注册的每一项贡献都会进入
 * 同一个清理账本；激活失败、结果过期和正常停用都从这里逆序回滚。
 */
export function createExternalRendererActivationScope(): ExternalRendererActivationScope {
  const disposers = new Set<() => void>();
  let disposed = false;

  return {
    add(dispose) {
      let active = true;
      const tracked = () => {
        if (!active) {
          return;
        }
        dispose();
        active = false;
        disposers.delete(tracked);
      };
      disposers.add(tracked);
      if (disposed) {
        tracked();
      }
      return tracked;
    },
    dispose() {
      if (disposed && disposers.size === 0) {
        return;
      }
      disposed = true;
      const failures: unknown[] = [];
      for (const dispose of [...disposers].reverse()) {
        try {
          dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "external renderer plugin activation cleanup failed"
        );
      }
    },
  };
}
