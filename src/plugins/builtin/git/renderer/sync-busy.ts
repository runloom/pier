/**
 * 同仓库远端同步并发去重 + busy 态共享。
 * key 必须是 **gitRoot**（与 activeGitTarget / remoteSync 登记一致）。
 */
const inFlightSyncs = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getInFlightSync(gitRoot: string): Promise<void> | undefined {
  return inFlightSyncs.get(gitRoot);
}

export function isSyncBusy(gitRoot: string): boolean {
  return inFlightSyncs.has(gitRoot);
}

export function subscribeSyncBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 注册 in-flight 同步;完成(含失败)后清除并通知订阅者。 */
export function trackSync(
  gitRoot: string,
  run: () => Promise<void>
): Promise<void> {
  const promise = run().finally(() => {
    inFlightSyncs.delete(gitRoot);
    emit();
  });
  inFlightSyncs.set(gitRoot, promise);
  emit();
  return promise;
}
