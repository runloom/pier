/**
 * 共享的 dockview web overlay 元素对账器。
 *
 * 两类 overlay（分栏 / 浮组 + 拖拽落点）都需要同一套生命周期：根节点
 * childList 变化时按当前 DOM 集合增删注册项，inline style 变化后合并到
 * 下一帧 flush，元素移除时释放 native 几何。这里把「集合对账 + rAF 合并」
 * 收成一份实现，具体的选择器 / 外观采样 / 额外清理由调用方注入。
 */

export interface ReconciledOverlayEntry {
  /** 元素被移除时的额外清理（transition 帧、事件监听等）。 */
  dispose?: () => void;
  observer: MutationObserver;
  registration: {
    dispose(): void;
    flush(): void;
  };
}

export interface DomOverlayReconcilerOptions<T extends HTMLElement> {
  collect: () => Iterable<T>;
  /** 根节点 childList 变化时，是否要立刻拆掉该元素（不等下一次 rAF）。 */
  disposeOnRootMutation?: (element: T) => boolean;
  register: (element: T, schedule: () => void) => ReconciledOverlayEntry;
  root: HTMLElement;
}

export interface DomOverlayReconciler {
  dispose(): void;
  schedule(): void;
  sync(): void;
}

export function createDomOverlayReconciler<T extends HTMLElement>(
  options: DomOverlayReconcilerOptions<T>
): DomOverlayReconciler {
  const entries = new Map<T, ReconciledOverlayEntry>();
  let frameRequest: number | null = null;
  let disposed = false;

  function disposeEntry(element: T): void {
    const entry = entries.get(element);
    if (!entry) {
      return;
    }
    entries.delete(element);
    entry.observer.disconnect();
    entry.dispose?.();
    entry.registration.dispose();
  }

  function sync(): void {
    frameRequest = null;
    if (disposed) {
      return;
    }
    const current = new Set(options.collect());
    for (const element of current) {
      const existing = entries.get(element);
      if (existing) {
        existing.registration.flush();
        continue;
      }
      entries.set(element, options.register(element, schedule));
    }
    for (const element of [...entries.keys()]) {
      if (!current.has(element)) {
        disposeEntry(element);
      }
    }
  }

  function schedule(): void {
    if (disposed || frameRequest !== null) {
      return;
    }
    frameRequest = requestAnimationFrame(sync);
  }

  const rootObserver = new MutationObserver(() => {
    if (options.disposeOnRootMutation) {
      for (const element of [...entries.keys()]) {
        if (options.disposeOnRootMutation(element)) {
          disposeEntry(element);
        }
      }
    }
    schedule();
  });
  rootObserver.observe(options.root, { childList: true, subtree: true });

  sync();

  return {
    dispose() {
      disposed = true;
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      rootObserver.disconnect();
      for (const element of [...entries.keys()]) {
        disposeEntry(element);
      }
    },
    schedule,
    sync,
  };
}
