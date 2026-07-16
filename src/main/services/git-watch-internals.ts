import { type FSWatcher, watch as fsWatchNative } from "node:fs";
import { posix, resolve, sep, win32 } from "node:path";
import type {
  GitChangeEvent,
  GitChangeKind,
} from "../../shared/contracts/git.ts";
import type { RefsTable } from "./git-refs-table.ts";
import type { HubAgent, RefsSnapshot, RepoHub } from "./git-watch-hub.ts";
import {
  defaultWorktreeSignature,
  defaultWorktreeSnapshot,
  type WorktreeSnapshot,
} from "./git-watch-signatures.ts";

/** 从 git-watch-service 拆出的内部构件（file-size 上限）：entry 结构与纯函数助手。 */

interface WatchComputationContext {
  readonly signal: AbortSignal;
}

export type FsWatchFn = (
  path: string,
  options?: { recursive?: boolean }
) => FSWatcher;

export interface WatchEntry {
  /** 当前签名代际；最后退订或 service dispose 时中止 Git/stat 工作。 */
  abortController: AbortController | null;
  /** baseline 期间发生过 fs 事件；基线完成后必须发一次重读信号。 */
  baselineDirty: boolean;
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
  /** entry 整个订阅生命周期：约束异步锚点解析等非 refresh 工作。 */
  lifecycleAbortController: AbortController;
  listeners: Set<(event: GitChangeEvent) => void>;
  /** baseline 期间收到 pulse → 排队，baseline 完成后补一轮（不丢外部驱动信号）。 */
  pendingPulse: boolean;
  /** refresh 执行中收到的 hub refs：快照、null=自算 fallback、undefined=无。 */
  pendingRefsSnap: RefsSnapshot | null | undefined;
  /** standalone 模式的兜底 poll；挂接 hub 后上收（置 null）。 */
  pollTimer: NodeJS.Timeout | null;
  /** watcher recreate 冷却截止时刻（ms epoch）。 */
  recreateCoolingUntil: number;
  /** watcher 重建失败后的受控重试定时器。 */
  recreateTimer: NodeJS.Timeout | null;
  /** refresh 正在执行中（A6：每 root 串行化）。 */
  refreshing: boolean;
  refsSig: string;
  repoStateSig: string;
  /** refresh 执行期间又被请求 → 结束后合并成一轮 trailing refresh（A6）。 */
  rerunRequested: boolean;
  watcher: FSWatcher | null;
  worktreeSig: string;
}

export function closeWatchEntryWatcher(entry: WatchEntry): void {
  try {
    entry.watcher?.close();
  } catch {
    // watcher 已失效
  }
  entry.watcher = null;
}

export function collectRepoHubs(entries: Iterable<WatchEntry>): RepoHub[] {
  return [
    ...new Set(
      [...entries].flatMap((entry) => (entry.hub === null ? [] : [entry.hub]))
    ),
  ];
}

/** 父目录 watcher 收到嵌套 worktree 事件时，路由给最具体的已订阅根。 */
export function findNestedWatchRoot(
  gitRoot: string,
  filename: unknown,
  roots: Iterable<string>
): string | null {
  if (typeof filename !== "string") {
    return null;
  }
  const changedPath = resolve(gitRoot, filename);
  let match: string | null = null;
  for (const root of roots) {
    if (
      root !== gitRoot &&
      (changedPath === root || changedPath.startsWith(`${root}${sep}`)) &&
      (match === null || root.length > match.length)
    ) {
      match = root;
    }
  }
  return match;
}

/** 仅接受真正的后代路径；按目标平台语义处理分隔符、盘符和大小写。 */
export function isPathInsideWatchRoot(
  root: string,
  candidate: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const relativePath = pathApi.relative(root, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  );
}

export async function loadWorktreeSnapshot(
  computeSignature: (
    gitRoot: string,
    context?: WatchComputationContext
  ) => Promise<string>,
  gitRoot: string,
  context: WatchComputationContext
): Promise<WorktreeSnapshot> {
  if (computeSignature === defaultWorktreeSignature) {
    return await defaultWorktreeSnapshot(gitRoot, undefined, context);
  }
  return {
    reliable: true,
    signature: await computeSignature(gitRoot, context),
  };
}

/** refs 三态：null 自算，快照直接用，undefined 在 hub 模式复用既有签名。 */
export function resolveRefsSignature(
  computeSignature: (
    gitRoot: string,
    context?: WatchComputationContext
  ) => Promise<string>,
  entry: WatchEntry,
  gitRoot: string,
  snapshot: RefsSnapshot | null | undefined,
  context: WatchComputationContext
): Promise<string> {
  if (snapshot === null) {
    return computeSignature(gitRoot, context);
  }
  if (snapshot !== undefined) {
    return Promise.resolve(snapshot.signature);
  }
  return entry.hub === null
    ? computeSignature(gitRoot, context)
    : Promise.resolve(entry.refsSig);
}

/** fs.watch 在 POSIX 上把反斜杠当普通文件名字节；仅 Windows 才归一为分隔符。 */
export function normalizeWatchEventPath(
  rawPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32" ? rawPath.split("\\").join("/") : rawPath;
}

export function applyRefsSnapshotTable(
  entry: Pick<WatchEntry, "lastRefsTable">,
  snapshot?: RefsSnapshot | null
): void {
  if (snapshot !== undefined) {
    entry.lastRefsTable = snapshot?.table ?? null;
  }
}

interface RecoverWatchEntryOptions {
  readonly attachHandlers: () => void;
  readonly cooldownMs: number;
  readonly entry: WatchEntry;
  readonly fsWatch: FsWatchFn;
  readonly gitRoot: string;
  readonly isCurrent: () => boolean;
}

/**
 * 工作树 watcher 的受控重建：同步创建失败不会逃出 EventEmitter，且同一 entry
 * 只保留一个冷却重试。调用方仍拥有事件过滤与 entry 注册表身份判断。
 */
export function recoverWatchEntry({
  attachHandlers,
  cooldownMs,
  entry,
  fsWatch,
  gitRoot,
  isCurrent,
}: RecoverWatchEntryOptions): void {
  if (!isCurrent()) {
    return;
  }
  const scheduleRetry = (): void => {
    if (entry.recreateTimer !== null || !isCurrent()) {
      return;
    }
    const delay = Math.max(0, entry.recreateCoolingUntil - Date.now());
    entry.recreateTimer = setTimeout(() => {
      entry.recreateTimer = null;
      recoverWatchEntry({
        attachHandlers,
        cooldownMs,
        entry,
        fsWatch,
        gitRoot,
        isCurrent,
      });
    }, delay);
  };

  const now = Date.now();
  if (now < entry.recreateCoolingUntil) {
    scheduleRetry();
    return;
  }
  entry.recreateCoolingUntil = now + cooldownMs;
  closeWatchEntryWatcher(entry);
  try {
    entry.watcher = fsWatch(gitRoot, { recursive: true });
  } catch {
    scheduleRetry();
    return;
  }
  attachHandlers();
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
 * standalone watcher 必须自行消费的 Git 元数据事件。
 * hub 挂接完成后这些路径才交给 hub 排他处理；lock/cookie 始终只是协议噪声。
 */
export function isGitMetadataTreeEvent(
  rawPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const relPath = normalizeWatchEventPath(rawPath, platform);
  return (
    relPath.startsWith(".git/") &&
    !relPath.endsWith(".lock") &&
    !relPath.includes(".watchman-cookie")
  );
}

/**
 * 工作树事件过滤：hub 已挂接时 `.git/**` 归 hub 排他所有（主仓 checkout 不双报），
 * node_modules 是安装风暴源（VS Code files.watcherExclude 同款默认，poll 兜底），
 * lock/watchman-cookie 是 git 写入协议噪声。filename 未知（null）时保守放行。
 */
export function isNoiseTreeEvent(
  rawPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const relPath = normalizeWatchEventPath(rawPath, platform);
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
