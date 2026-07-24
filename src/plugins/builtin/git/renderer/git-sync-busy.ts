/**
 * 同仓库远端同步并发去重 + busy 态共享。
 * key 是 worktreePath：同一工作树的多个终端面板共享同一 in-flight 状态,
 * 状态栏同步项据此旋转/禁点,动作层据此拒绝重复触发。
 */
const inFlightSyncs = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getInFlightSync(
  worktreePath: string
): Promise<void> | undefined {
  return inFlightSyncs.get(worktreePath);
}

export function isSyncBusy(worktreePath: string): boolean {
  return inFlightSyncs.has(worktreePath);
}

export function subscribeSyncBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 注册 in-flight 同步;完成(含失败)后清除并通知订阅者。 */
export function trackSync(
  worktreePath: string,
  run: () => Promise<void>
): Promise<void> {
  const promise = run().finally(() => {
    inFlightSyncs.delete(worktreePath);
    emit();
  });
  inFlightSyncs.set(worktreePath, promise);
  emit();
  return promise;
}
