import { createHash } from "node:crypto";
import { type FSWatcher, watch as fsWatchNative } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitChangeEvent,
  GitChangeKind,
  GitStatus,
} from "../../shared/contracts/git.ts";
import { execGit } from "./git-exec.ts";

const DEFAULT_DEBOUNCE_MS = 400;
/**
 * 单次 fs event burst 内，从首事件起最长 maxWait 一定 refresh。
 * 避免 AI 一次写百文件时纯 trailing debounce 被反复重排导致长时间不更新。
 */
const DEFAULT_MAX_WAIT_MS = 1500;
/** 5s 兜底轮询：fs.watch 掉事件或非可靠 FS 时保 latency 上界 ≤ 5s。 */
const DEFAULT_POLL_MS = 5000;
/** watcher recreate 冷却窗：防止连续 error 触发无限重建。 */
const WATCHER_RECREATE_COOLDOWN_MS = 5000;

export type FsWatchFn = (
  path: string,
  options?: { recursive?: boolean }
) => FSWatcher;

export interface CreateGitWatchServiceOptions {
  /** sha256(HEAD oid + symbolic-ref HEAD)。注入便于测试。 */
  computeHeadSignature?: (gitRoot: string) => Promise<string>;
  /**
   * `.git/*_HEAD` 与 rebase 步进的存在性/内容签名。变化 → 归入 worktree changeKind。
   * 默认实现读 gitDir 下 MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD / BISECT_START /
   * rebase-merge/msgnum / rebase-apply/next。gitDir 通过 `git rev-parse` 解析并缓存。
   */
  computeRepoStateSignature?: (gitRoot: string) => Promise<string>;
  /** sha256(git status --porcelain=v2 -z)。注入便于测试。 */
  computeWorktreeSignature?: (gitRoot: string) => Promise<string>;
  debounceMs?: number;
  /** fs.watch 替身。默认尝试 recursive,失败 fallback 到 .git 目录。 */
  fsWatch?: FsWatchFn;
  /**
   * 获取完整 GitStatus。变化触发时一并算出随广播下发，
   * 让多个 renderer 订阅者共享一份 snapshot，免各自 IPC refetch + 消除竞态。
   */
  getStatus?: (gitRoot: string) => Promise<GitStatus>;
  maxWaitMs?: number;
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
  /** burst 内首个 fs event 时刻；用于 max-wait 计算。空闲时 null。 */
  firstEventAt: number | null;
  headSig: string;
  listeners: Set<(event: GitChangeEvent) => void>;
  pollTimer: NodeJS.Timeout;
  /** watcher recreate 冷却截止时刻（ms epoch）。 */
  recreateCoolingUntil: number;
  repoStateSig: string;
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

async function fileExistsMark(path: string, mark: string): Promise<string> {
  try {
    await access(path);
    return mark;
  } catch {
    return "";
  }
}

async function readFileTrim(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

/**
 * gitDir 解析缓存。gitDir 在 worktree 生命周期内稳定，缓存一次即可。
 * 缓存在模块作用域是有意的：同一 gitRoot 可能被多个 WatchService 实例监听。
 */
const gitDirCache = new Map<string, string>();

async function resolveGitDir(gitRoot: string): Promise<string | null> {
  const cached = gitDirCache.get(gitRoot);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const out = await execGit(
      ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
      { cwd: gitRoot }
    );
    const gitDir = out.trim();
    if (gitDir.length > 0) {
      gitDirCache.set(gitRoot, gitDir);
      return gitDir;
    }
    return null;
  } catch {
    return null;
  }
}

async function defaultRepoStateSignature(gitRoot: string): Promise<string> {
  const gitDir = await resolveGitDir(gitRoot);
  if (gitDir === null) {
    return "";
  }
  const [merge, cherry, revert, bisect, rebaseMergeStep, rebaseApply] =
    await Promise.all([
      fileExistsMark(join(gitDir, "MERGE_HEAD"), "M"),
      fileExistsMark(join(gitDir, "CHERRY_PICK_HEAD"), "C"),
      fileExistsMark(join(gitDir, "REVERT_HEAD"), "R"),
      fileExistsMark(join(gitDir, "BISECT_START"), "B"),
      readFileTrim(join(gitDir, "rebase-merge", "msgnum")),
      fileExistsMark(join(gitDir, "rebase-apply"), "A"),
    ]);
  // 用 hash 保签名短小；rebase 步进（msgnum 内容）折进 hash 让每步都触发广播
  return createHash("sha256")
    .update(
      `${merge}|${cherry}|${revert}|${bisect}|${rebaseMergeStep}|${rebaseApply}`
    )
    .digest("hex");
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
 * - fs.watch 触发 → debounce(min(400ms, maxWait-elapsed)) → 重算三签名 → 比对 → 通知 listeners
 *   - 三签名：worktree（status hash）、head（HEAD oid + symbolic-ref）、repoState（.git/*_HEAD + rebase 步）
 *   - worktree 或 repoState 变化 → changeKind 含 "worktree"
 * - Max-wait debounce：burst 内首事件后最多 maxWait 一定 refresh；burst 结束后 debounce 再补一次
 * - Broadcast 携带 status snapshot：getStatus 注入时，变化触发一并算完整 GitStatus 下发
 * - 5s 兜底轮询防止 watcher 漏事件；watcher error 走 5s 冷却重建
 * - 引用计数:多个 listener 共用同一 fs watcher
 * - 签名 hash 化避免大输出常驻内存
 */
export function createGitWatchService({
  computeWorktreeSignature = defaultWorktreeSignature,
  computeHeadSignature = defaultHeadSignature,
  computeRepoStateSignature = defaultRepoStateSignature,
  fsWatch = defaultFsWatch,
  getStatus,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  pollMs = DEFAULT_POLL_MS,
}: CreateGitWatchServiceOptions = {}): GitWatchService {
  const entries = new Map<string, WatchEntry>();

  async function refresh(gitRoot: string, force: boolean): Promise<void> {
    const entry = entries.get(gitRoot);
    if (!entry) {
      return;
    }
    const [nextWorktree, nextHead, nextRepoState] = await Promise.all([
      computeWorktreeSignature(gitRoot),
      computeHeadSignature(gitRoot),
      computeRepoStateSignature(gitRoot),
    ]);
    const worktreeChanged = nextWorktree !== entry.worktreeSig;
    const headChanged = nextHead !== entry.headSig;
    const repoStateChanged = nextRepoState !== entry.repoStateSig;
    entry.worktreeSig = nextWorktree;
    entry.headSig = nextHead;
    entry.repoStateSig = nextRepoState;
    if (force) {
      return;
    }
    const changeKind = deriveChangeKind(
      worktreeChanged || repoStateChanged,
      headChanged
    );
    if (!changeKind) {
      return;
    }
    // 有变化 → 一并算 status 随广播下发（多订阅者共享，免 renderer refetch）
    let status: GitStatus | undefined;
    if (getStatus) {
      try {
        status = await getStatus(gitRoot);
      } catch {
        // getStatus 失败不阻塞广播；renderer 接到不带 status 的广播会走 getStatus IPC fallback
      }
    }
    for (const listener of entry.listeners) {
      listener(
        status === undefined
          ? { changeKind, gitRoot }
          : { changeKind, gitRoot, status }
      );
    }
  }

  function scheduleRefresh(gitRoot: string): void {
    const entry = entries.get(gitRoot);
    if (!entry?.baselineReady) {
      // baseline 未完成,fs event 静默丢弃(避免与初始 "" 签名误比较)
      return;
    }
    const now = Date.now();
    if (entry.firstEventAt === null) {
      entry.firstEventAt = now;
    }
    const elapsed = now - entry.firstEventAt;
    // max-wait：从 burst 首事件起最多等 maxWait ms；不够 debounceMs 就按剩余时间跑
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      const target = entries.get(gitRoot);
      if (target) {
        target.debounceTimer = null;
        target.firstEventAt = null;
      }
      refresh(gitRoot, false).catch(() => {
        // 单次失败由下一次 fs 事件或轮询兜底
      });
    }, delay);
  }

  function attachWatcherHandlers(entry: WatchEntry, gitRoot: string): void {
    entry.watcher.on("change", () => scheduleRefresh(gitRoot));
    entry.watcher.on("error", () => safeRecreateWatcher(entry, gitRoot));
  }

  function safeRecreateWatcher(entry: WatchEntry, gitRoot: string): void {
    const now = Date.now();
    if (now < entry.recreateCoolingUntil) {
      // 冷却期内不重建；靠 poll 兜底
      return;
    }
    entry.recreateCoolingUntil = now + WATCHER_RECREATE_COOLDOWN_MS;
    try {
      entry.watcher.close();
    } catch {
      // watcher 已 dead
    }
    entry.watcher = fsWatch(gitRoot, { recursive: true });
    attachWatcherHandlers(entry, gitRoot);
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
        firstEventAt: null,
        headSig: "",
        listeners: new Set(),
        pollTimer,
        recreateCoolingUntil: 0,
        repoStateSig: "",
        watcher,
        worktreeSig: "",
      };
      entries.set(gitRoot, entry);
      attachWatcherHandlers(entry, gitRoot);
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
