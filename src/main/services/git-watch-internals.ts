import { type FSWatcher, watch as fsWatchNative } from "node:fs";
import type {
  GitChangeEvent,
  GitChangeKind,
} from "../../shared/contracts/git.ts";
import type { RefsTable } from "./git-refs-table.ts";
import type { HubAgent, RefsSnapshot, RepoHub } from "./git-watch-hub.ts";

/** 从 git-watch-service 拆出的内部构件（file-size 上限）：entry 结构与纯函数助手。 */

export type FsWatchFn = (
  path: string,
  options?: { recursive?: boolean }
) => FSWatcher;

export interface WatchEntry {
  /**
   * baseline(initial refresh force=true)是否已完成。
   * 完成前所有 fs event 与 poll 都被忽略,避免 worktreeSig/headSig 仍为 ""
   * 与新签名比较时误报 changeKind="both"。
   */
  baselineReady: boolean;
  debounceTimer: NodeJS.Timeout | null;
  /** burst 内首个 fs event 时刻；用于 max-wait 计算。空闲时 null。 */
  firstEventAt: number | null;
  headSig: string;
  /** 挂接的 repo hub；anchors 解析失败或未完成时为 null（standalone 模式）。 */
  hub: RepoHub | null;
  /** 注册到 hub 的句柄（detach 时需要同一引用）。 */
  hubHandle: HubAgent | null;
  /** hub 最近一轮下发的共享 refs 表；随 prefetched 传给 getStatus。 */
  lastRefsTable: RefsTable | null;
  listeners: Set<(event: GitChangeEvent) => void>;
  /** baseline 期间收到 pulse → 排队，baseline 完成后补一轮（不丢外部驱动信号）。 */
  pendingPulse: boolean;
  /** refresh 执行中收到的 hub refs 快照；trailing 轮消费。 */
  pendingRefsSnap: RefsSnapshot | null;
  /** standalone 模式的兜底 poll；挂接 hub 后上收（置 null）。 */
  pollTimer: NodeJS.Timeout | null;
  /** watcher recreate 冷却截止时刻（ms epoch）。 */
  recreateCoolingUntil: number;
  /** refresh 正在执行中（A6：每 root 串行化）。 */
  refreshing: boolean;
  refsSig: string;
  repoStateSig: string;
  /** refresh 执行期间又被请求 → 结束后合并成一轮 trailing refresh（A6）。 */
  rerunRequested: boolean;
  watcher: FSWatcher;
  worktreeSig: string;
}

export function defaultFsWatch(path: string): FSWatcher {
  try {
    return fsWatchNative(path, { recursive: true });
  } catch {
    // Linux 不支持 recursive 时,降级只 watch .git(HEAD/index 变更仍能捕获)
    return fsWatchNative(`${path}/.git`);
  }
}

export function deriveChangeKind(
  worktreeChanged: boolean,
  headChanged: boolean,
  refsChanged: boolean
): GitChangeKind | null {
  if (worktreeChanged && headChanged) {
    return "both";
  }
  if (worktreeChanged) {
    return "worktree";
  }
  if (headChanged) {
    return "head";
  }
  if (refsChanged) {
    return "refs";
  }
  return null;
}

/**
 * 工作树事件过滤：`.git/**` 归 hub 排他所有（主仓 checkout 不双报），
 * node_modules 是安装风暴源（VS Code files.watcherExclude 同款默认，poll 兜底），
 * lock/watchman-cookie 是 git 写入协议噪声。filename 未知（null）时保守放行。
 */
export function isNoiseTreeEvent(rawPath: string): boolean {
  const relPath = rawPath.split("\\").join("/");
  if (relPath === ".git") {
    return false; // worktree 指针文件重写（repair/move）：有效信号
  }
  return (
    relPath.startsWith(".git/") ||
    relPath.endsWith(".lock") ||
    relPath.includes(".watchman-cookie") ||
    relPath === "node_modules" ||
    relPath.startsWith("node_modules/") ||
    relPath.includes("/node_modules/")
  );
}
