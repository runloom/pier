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

export function createKeyedMutationLanes(): (
  key: string
) => <T>(operation: () => Promise<T>) => Promise<T> {
  const lanes = new Map<string, ReturnType<typeof createSerialMutationQueue>>();
  return (key: string) => {
    const existing = lanes.get(key);
    if (existing) {
      return existing;
    }
    const created = createSerialMutationQueue();
    lanes.set(key, created);
    return created;
  };
}
