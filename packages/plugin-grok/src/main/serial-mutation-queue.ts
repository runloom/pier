/**
 * Serial mutation queue: the next operation runs only after the previous
 * settles. A prior rejection does not stop the queue — the tail chain swallows
 * rejections so one account action cannot block later ones. Callers still see
 * their own rejection via the returned promise.
 */
export function createSerialMutationQueue(): <T>(
  operation: () => Promise<T>
) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
