import type { RendererPluginContext } from "@plugins/api/renderer.ts";

interface RootWatch {
  close: () => void;
  error: Error | null;
  listeners: Set<(error?: Error) => void>;
  start: () => void;
}
const roots = new WeakMap<RendererPluginContext, Map<string, RootWatch>>();
export function watchFileChangesRoot(
  context: RendererPluginContext,
  root: string,
  listener: (error?: Error) => void
): () => void {
  let map = roots.get(context);
  if (!map) {
    map = new Map();
    roots.set(context, map);
  }
  let slot = map.get(root);
  if (!slot) {
    const listeners = new Set<(error?: Error) => void>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const emit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const callback of listeners) callback();
      }, 200);
    };
    const created: RootWatch = {
      error: null,
      listeners,
      close: () => {
        clearTimeout(timer);
        unsubscribe();
      },
      start: () => {
        clearTimeout(timer);
        unsubscribe();
        created.error = null;
        unsubscribe = context.git.watch(
          root,
          emit,
          (error) => {
            clearTimeout(timer);
            created.error = error;
            for (const callback of listeners) callback(error);
          },
          emit
        );
      },
    };
    slot = created;
    map.set(root, slot);
    slot.start();
  }
  const current = slot;
  current.listeners.add(listener);
  if (current.error)
    queueMicrotask(() => {
      if (current.error && current.listeners.has(listener))
        listener(current.error);
    });
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.close();
      map.delete(root);
    }
  };
}

export function retryFileChangesRoot(
  context: RendererPluginContext,
  root: string
): void {
  const slot = roots.get(context)?.get(root);
  if (slot?.error) slot.start();
}
