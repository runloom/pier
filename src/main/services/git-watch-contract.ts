import type { GitChangeEvent, GitStatus } from "../../shared/contracts/git.ts";
import type { PrefetchedStatus } from "./git-status-assembler.ts";
import type { FsWatchFn } from "./git-watch-internals.ts";
import type { RepoAnchors } from "./git-watch-signatures.ts";

export interface GitWatchComputationContext {
  readonly signal: AbortSignal;
}

export interface CreateGitWatchServiceOptions {
  /** sha256(HEAD oid + symbolic-ref HEAD)。注入便于测试。 */
  computeHeadSignature?: (
    gitRoot: string,
    context?: GitWatchComputationContext
  ) => Promise<string>;
  /** refs 签名：heads/remotes/stash 的 refname、oid、upstream、track 与 symref。 */
  computeRefsSignature?: (
    gitRoot: string,
    context?: GitWatchComputationContext
  ) => Promise<string>;
  /** `.git/*_HEAD` 与 rebase 步进的存在性/内容签名。 */
  computeRepoStateSignature?: (
    gitRoot: string,
    context?: GitWatchComputationContext
  ) => Promise<string>;
  /** sha256(porcelain v2 branch + unstaged/staged numstat)。 */
  computeWorktreeSignature?: (
    gitRoot: string,
    context?: GitWatchComputationContext
  ) => Promise<string>;
  debounceMs?: number;
  /** fs.watch 替身。默认先尝试 recursive，失败时回退到 `.git`。 */
  fsWatch?: FsWatchFn;
  /** 变化广播携带的共享状态快照；prefetched 复用本轮原始输出和 refs 表。 */
  getStatus?: (
    gitRoot: string,
    prefetched?: PrefetchedStatus
  ) => Promise<GitStatus>;
  /** 返回 false 时只停止兜底轮询，不影响 fs 事件和 pulse。 */
  isPollActive?: () => boolean;
  maxWaitMs?: number;
  pollMs?: number;
  /** 失败时保留 standalone 模式，不建立仓库级 hub。 */
  resolveRepoAnchors?: (
    gitRoot: string,
    context?: GitWatchComputationContext
  ) => Promise<RepoAnchors | null>;
}

export interface GitWatchService {
  /** 有订阅者的 gitRoot 列表。 */
  activeRoots(): string[];
  /** 主动关闭全部 watcher 与轮询器。 */
  dispose(): Promise<void>;
  /** 写操作或聚焦补课后立即走既有签名比对和广播。 */
  pulse(gitRoot: string): void;
  /** 同一 gitRoot 的订阅者共享底层 watcher；最后一个退订时释放。 */
  watch(gitRoot: string, listener: (event: GitChangeEvent) => void): () => void;
}
