import type { GitRemoteSync } from "../../../shared/contracts/git.ts";

/**
 * 远端同步健康度登记表（main 进程内存态）。
 * 写入方：autofetch service + 用户触发的 git.fetch（按 root / worktree fan-out）。
 * 读取方：status 组装。
 * 不落盘：进程重启后回到"未知"（null），下一轮 fetch 重建。
 */
const syncByRoot = new Map<string, GitRemoteSync>();

/** autofetch 每轮对分组内全部 roots 写同一份状态（fetch 以 commonDir 为粒度执行）。 */
export function recordRemoteSync(
  roots: readonly string[],
  sync: GitRemoteSync
): void {
  for (const root of roots) {
    syncByRoot.set(root, sync);
  }
}

export function getRemoteSync(gitRoot: string): GitRemoteSync | null {
  return syncByRoot.get(gitRoot) ?? null;
}

export function clearRemoteSyncForTests(): void {
  syncByRoot.clear();
}
