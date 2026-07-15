/**
 * Coalesce concurrent async work by key so the same resource cannot stampede
 * into parallel expensive operations (e.g. multi-hop usage refresh).
 */
export function createInflightCoalescer(): {
  run: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  size: () => number;
} {
  const inflight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) {
        return existing as Promise<T>;
      }
      const promise = task().finally(() => {
        if (inflight.get(key) === promise) {
          inflight.delete(key);
        }
      });
      inflight.set(key, promise);
      return promise;
    },
    size: () => inflight.size,
  };
}
