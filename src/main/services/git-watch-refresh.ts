import type { GitChangeKind, GitStatus } from "../../shared/contracts/git.ts";
import type { PrefetchedStatus } from "./git-status-assembler.ts";
import type { CreateGitWatchServiceOptions } from "./git-watch-contract.ts";
import type { RefsSnapshot } from "./git-watch-hub.ts";
import {
  applyRefsSnapshotTable,
  deriveChangeKind,
  loadWorktreeSnapshot,
  resolveRefsSignature,
  type WatchEntry,
} from "./git-watch-internals.ts";
import type { RawWorktreeSnapshot } from "./git-watch-signatures.ts";

type HeadSignatureComputer = NonNullable<
  CreateGitWatchServiceOptions["computeHeadSignature"]
>;
type RefsSignatureComputer = NonNullable<
  CreateGitWatchServiceOptions["computeRefsSignature"]
>;
type RepoStateSignatureComputer = NonNullable<
  CreateGitWatchServiceOptions["computeRepoStateSignature"]
>;
type WorktreeSignatureComputer = NonNullable<
  CreateGitWatchServiceOptions["computeWorktreeSignature"]
>;

interface GitWatchRefreshCoordinatorOptions {
  readonly computeHeadSignature: HeadSignatureComputer;
  readonly computeRefsSignature: RefsSignatureComputer;
  readonly computeRepoStateSignature: RepoStateSignatureComputer;
  readonly computeWorktreeSignature: WorktreeSignatureComputer;
  readonly entries: Map<string, WatchEntry>;
  readonly getStatus: CreateGitWatchServiceOptions["getStatus"];
  readonly inFlightRefreshes: Set<Promise<void>>;
}

interface GitWatchRefreshCoordinator {
  broadcastChange(
    entry: WatchEntry,
    gitRoot: string,
    changeKind: GitChangeKind,
    raw?: RawWorktreeSnapshot
  ): Promise<void>;
  refresh(
    gitRoot: string,
    force: boolean,
    refsSnapshot?: RefsSnapshot | null
  ): Promise<void>;
}

async function stopRefreshOnAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw new Error("Git watch refresh aborted");
  }
  let removeAbortListener = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new Error("Git watch refresh aborted"));
    signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", abort);
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    removeAbortListener();
  }
}

/**
 * 每个 Git 根的签名计算、串行合并与广播所有权。
 * watcher/hub 只负责触发，service 只负责订阅生命周期。
 */
export function createGitWatchRefreshCoordinator({
  computeHeadSignature,
  computeRefsSignature,
  computeRepoStateSignature,
  computeWorktreeSignature,
  entries,
  getStatus,
  inFlightRefreshes,
}: GitWatchRefreshCoordinatorOptions): GitWatchRefreshCoordinator {
  /** 广播时复用本轮工作树原始输出与 hub refs 表，失败则由 renderer 回读。 */
  async function broadcastChange(
    entry: WatchEntry,
    gitRoot: string,
    changeKind: GitChangeKind,
    raw?: RawWorktreeSnapshot
  ): Promise<void> {
    let status: GitStatus | undefined;
    if (getStatus) {
      let prefetched: PrefetchedStatus | undefined;
      if (raw !== undefined) {
        prefetched =
          entry.lastRefsTable === null
            ? raw
            : { ...raw, refsTable: entry.lastRefsTable };
      }
      try {
        status = await getStatus(gitRoot, prefetched);
      } catch {
        // 广播仍然成立；renderer 接到不带 status 的事件后走 getStatus IPC。
      }
    }
    if (entries.get(gitRoot) !== entry) {
      return;
    }
    for (const listener of entry.listeners) {
      listener(
        status === undefined
          ? { changeKind, gitRoot }
          : { changeKind, gitRoot, status }
      );
    }
  }

  async function runRefresh(
    entry: WatchEntry,
    gitRoot: string,
    force: boolean,
    refsSnapshot: RefsSnapshot | null | undefined,
    signal: AbortSignal
  ): Promise<void> {
    if (refsSnapshot === null) {
      // fallback 开始即失效旧表；即使自算失败也不复用陈旧 refs 派生状态。
      applyRefsSnapshotTable(entry, refsSnapshot);
    }
    const [worktreeSnapshot, nextHead, nextRepoState, nextRefs] =
      await Promise.all([
        loadWorktreeSnapshot(computeWorktreeSignature, gitRoot, { signal }),
        computeHeadSignature(gitRoot, { signal }),
        computeRepoStateSignature(gitRoot, { signal }),
        resolveRefsSignature(
          computeRefsSignature,
          entry,
          gitRoot,
          refsSnapshot,
          { signal }
        ),
      ]);
    if (entries.get(gitRoot) !== entry) {
      return;
    }
    const nextWorktree = worktreeSnapshot.signature;
    applyRefsSnapshotTable(entry, refsSnapshot);
    const worktreeChanged =
      !worktreeSnapshot.reliable || nextWorktree !== entry.worktreeSig;
    const headChanged = nextHead !== entry.headSig;
    const repoStateChanged = nextRepoState !== entry.repoStateSig;
    const refsChanged = nextRefs !== entry.refsSig;
    entry.worktreeSig = nextWorktree;
    entry.headSig = nextHead;
    entry.repoStateSig = nextRepoState;
    entry.refsSig = nextRefs;
    if (force) {
      return;
    }
    const changeKind = deriveChangeKind(
      worktreeChanged || repoStateChanged,
      headChanged,
      refsChanged
    );
    if (changeKind) {
      await broadcastChange(entry, gitRoot, changeKind, worktreeSnapshot.raw);
    }
  }

  /** 同一根串行；执行中重复请求合并成一次尾随刷新。 */
  async function refresh(
    gitRoot: string,
    force: boolean,
    refsSnapshot?: RefsSnapshot | null
  ): Promise<void> {
    const entry = entries.get(gitRoot);
    if (!entry) {
      return;
    }
    if (entry.refreshing) {
      entry.rerunRequested = true;
      if (refsSnapshot !== undefined) {
        entry.pendingRefsSnap = refsSnapshot;
      }
      return;
    }
    entry.refreshing = true;
    const abortController = new AbortController();
    entry.abortController = abortController;
    const operation = stopRefreshOnAbort(
      runRefresh(entry, gitRoot, force, refsSnapshot, abortController.signal),
      abortController.signal
    );
    inFlightRefreshes.add(operation);
    try {
      await operation;
    } finally {
      inFlightRefreshes.delete(operation);
      if (entry.abortController === abortController) {
        entry.abortController = null;
      }
      entry.refreshing = false;
      if (entry.rerunRequested) {
        entry.rerunRequested = false;
        const pending = entry.pendingRefsSnap;
        entry.pendingRefsSnap = undefined;
        refresh(gitRoot, false, pending).catch(() => undefined);
      }
    }
  }

  return { broadcastChange, refresh };
}
