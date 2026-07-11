/** 把昂贵且可能失败的 app core 构造延后到受控启动 Promise 内。 */
export function createLazyAppCore<T extends object>(factory: () => T): T {
  let attempted = false;
  let failure: unknown;
  let value: T | undefined;

  const load = (): T => {
    if (!attempted) {
      attempted = true;
      try {
        value = factory();
      } catch (error) {
        failure = error;
      }
    }
    if (value) return value;
    throw failure;
  };

  return new Proxy({} as T, {
    get: (_target, property) => Reflect.get(load(), property),
  });
}
