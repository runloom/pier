/**
 * 串行 mutation 队列：前一个操作完成后才执行下一个。
 * 前一个操作失败不会中断队列——tail 链用 .then(_, _) 吞掉 rejection，
 * 保证一个账号操作失败不阻塞后续操作。调用方通过返回的 result 拿到自己的 rejection。
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
