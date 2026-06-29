import { createHash } from "node:crypto";
import { type FSWatcher, watch as fsWatchNative } from "node:fs";
import type {
  GitChangeEvent,
  GitChangeKind,
} from "../../shared/contracts/git.ts";
import { execGit } from "./git-exec.ts";

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_POLL_MS = 30_000;

export type FsWatchFn = (
  path: string,
  options?: { recursive?: boolean }
) => FSWatcher;

export interface CreateGitWatchServiceOptions {
  /** sha256(HEAD oid + symbolic-ref HEAD)。注入便于测试。 */
  computeHeadSignature?: (gitRoot: string) => Promise<string>;
  /** sha256(git status --porcelain=v2 -z)。注入便于测试。 */
  computeWorktreeSignature?: (gitRoot: string) => Promise<string>;
  debounceMs?: number;
  /** fs.watch 替身。默认尝试 recursive,失败 fallback 到 .git 目录。 */
  fsWatch?: FsWatchFn;
  pollMs?: number;
}

export interface GitWatchService {
  /** 主动关闭所有 watcher 和 poll timer。 */
  dispose(): Promise<void>;
  /**
   * 订阅 gitRoot 的 git 变化。返回 unsubscribe 函数。
   * 同一 gitRoot 多个 listener 共用一个底层 fs watcher(引用计数)。
   * 最后一个 listener 退订时,watcher 自动关闭。
   */
  watch(gitRoot: string, listener: (event: GitChangeEvent) => void): () => void;
}

interface WatchEntry {
  /**
   * baseline(initial refresh force=true)是否已完成。
   * 完成前所有 fs event 与 poll 都被忽略,避免 worktreeSig/headSig 仍为 ""
   * 与新签名比较时误报 changeKind="both"。
   */
  baselineReady: boolean;
  debounceTimer: NodeJS.Timeout | null;
  headSig: string;
  listeners: Set<(event: GitChangeEvent) => void>;
  pollTimer: NodeJS.Timeout;
  watcher: FSWatcher;
  worktreeSig: string;
}

async function defaultWorktreeSignature(gitRoot: string): Promise<string> {
  try {
    const output = await execGit(["status", "--porcelain=v2", "-z"], {
      cwd: gitRoot,
    });
    return createHash("sha256").update(output).digest("hex");
  } catch {
    return "";
  }
}

async function defaultHeadSignature(gitRoot: string): Promise<string> {
  let head = "";
  let ref = "";
  try {
    head = await execGit(["rev-parse", "HEAD"], { cwd: gitRoot });
  } catch {
    // 空仓库无 HEAD
  }
  try {
    ref = await execGit(["symbolic-ref", "-q", "HEAD"], { cwd: gitRoot });
  } catch {
    // detached HEAD
  }
  return createHash("sha256").update(`${head}\n${ref}`).digest("hex");
}

function defaultFsWatch(path: string): FSWatcher {
  try {
    return fsWatchNative(path, { recursive: true });
  } catch {
    // Linux 不支持 recursive 时,降级只 watch .git(HEAD/index 变更仍能捕获)
    return fsWatchNative(`${path}/.git`);
  }
}

function deriveChangeKind(
  worktreeChanged: boolean,
  headChanged: boolean
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
  return null;
}

/**
 * git 变更监听服务。
 * 设计:
 * - fs.watch 触发 → 400ms debounce → 重算签名 → 比对 → 通知 listeners
 * - 30s 兜底轮询防止 watcher 漏事件
 * - 引用计数:多个 listener 共用同一 fs watcher
 * - 签名(porcelain v2 status + HEAD ref)hash 化避免大输出常驻内存
 */
export function createGitWatchService({
  computeWorktreeSignature = defaultWorktreeSignature,
  computeHeadSignature = defaultHeadSignature,
  fsWatch = defaultFsWatch,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  pollMs = DEFAULT_POLL_MS,
}: CreateGitWatchServiceOptions = {}): GitWatchService {
  const entries = new Map<string, WatchEntry>();

  async function refresh(gitRoot: string, force: boolean): Promise<void> {
    const entry = entries.get(gitRoot);
    if (!entry) {
      return;
    }
    const [nextWorktree, nextHead] = await Promise.all([
      computeWorktreeSignature(gitRoot),
      computeHeadSignature(gitRoot),
    ]);
    const worktreeChanged = nextWorktree !== entry.worktreeSig;
    const headChanged = nextHead !== entry.headSig;
    entry.worktreeSig = nextWorktree;
    entry.headSig = nextHead;
    if (force) {
      return;
    }
    const changeKind = deriveChangeKind(worktreeChanged, headChanged);
    if (!changeKind) {
      return;
    }
    for (const listener of entry.listeners) {
      listener({ changeKind, gitRoot });
    }
  }

  function scheduleRefresh(gitRoot: string): void {
    const entry = entries.get(gitRoot);
    if (!entry?.baselineReady) {
      // baseline 未完成,fs event 静默丢弃(避免与初始 "" 签名误比较)
      return;
    }
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      const target = entries.get(gitRoot);
      if (target) {
        target.debounceTimer = null;
      }
      refresh(gitRoot, false).catch(() => {
        // 单次失败由下一次 fs 事件或轮询兜底
      });
    }, debounceMs);
  }

  function disposeEntry(entry: WatchEntry): void {
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    clearInterval(entry.pollTimer);
    entry.watcher.close();
  }

  function watch(
    gitRoot: string,
    listener: (event: GitChangeEvent) => void
  ): () => void {
    let entry = entries.get(gitRoot);
    if (!entry) {
      const watcher = fsWatch(gitRoot, { recursive: true });
      watcher.on("error", () => {
        // 兜底:watcher 内部错误(EBADF/EPERM 等)由轮询补救
      });
      const pollTimer = setInterval(() => {
        const target = entries.get(gitRoot);
        if (!target?.baselineReady) {
          return;
        }
        refresh(gitRoot, false).catch(() => undefined);
      }, pollMs);
      entry = {
        baselineReady: false,
        debounceTimer: null,
        headSig: "",
        listeners: new Set(),
        pollTimer,
        watcher,
        worktreeSig: "",
      };
      entries.set(gitRoot, entry);
      watcher.on("change", () => scheduleRefresh(gitRoot));
      // 初始签名采集:完成后才标 baselineReady,避免与初始 "" 签名比较误报
      refresh(gitRoot, true)
        .catch(() => undefined)
        .finally(() => {
          const target = entries.get(gitRoot);
          if (target) {
            target.baselineReady = true;
          }
        });
    }
    entry.listeners.add(listener);
    return () => {
      const target = entries.get(gitRoot);
      if (!target) {
        return;
      }
      target.listeners.delete(listener);
      if (target.listeners.size === 0) {
        disposeEntry(target);
        entries.delete(gitRoot);
      }
    };
  }

  function dispose(): Promise<void> {
    for (const entry of entries.values()) {
      disposeEntry(entry);
    }
    entries.clear();
    return Promise.resolve();
  }

  return { dispose, watch };
}
