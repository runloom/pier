import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { execGit } from "./git-exec.ts";
import { parseGitStatus } from "./git-parsers.ts";
import { parseGitSinglePathOutput } from "./git-path-output.ts";
import { fetchRefsTable } from "./git-refs-table.ts";
import {
  runChangedFileStatBatch,
  runChangedFileStatProbe,
  watchAccess,
  watchLstat,
  watchReadText,
  watchRealpath,
} from "./git-watch-file-system.ts";
import type { RefsSnapshot } from "./git-watch-hub.ts";
import { GitWatchPathCache } from "./git-watch-path-cache.ts";

/**
 * numstat 瞬时失败（如 index.lock）时写入签名的哨兵段。
 * 与任何真实 numstat 输出（含空串）都不同；快照同时标为不可靠，
 * 因此每次非基线刷新都会保守广播，恢复成功后再回到正常签名去重。
 */
const NUMSTAT_ERROR_SENTINEL = "numstat-unavailable";

/** 文件系统探测不得耗尽 libuv 队列；迟到操作也最多保留这一批。 */
const CONTENT_SIGNAL_STAT_CONCURRENCY = 16;
/** 网络盘或故障文件系统不能无限阻塞 watcher 刷新与 dispose。 */
const CONTENT_SIGNAL_STAT_TIMEOUT_MS = 1500;
const STAT_SIGNAL_UNAVAILABLE = "stat-signal-unavailable";
const GIT_WATCH_COMMAND_TIMEOUT_MS = 5000;

interface GitWatchComputationContext {
  readonly signal: AbortSignal;
}

interface ChangedFilesStatSignalOptions {
  readonly signal?: AbortSignal;
  readonly stat?: (
    path: string
  ) => Promise<{ readonly mtimeMs: number; readonly size: number }>;
  readonly timeoutMs?: number;
}

/**
 * 变更文件的内容变化信号。status/numstat 文本对"同一文件再次改写且增删行数
 * 不变"不敏感（porcelain 不含工作树内容 hash），单靠它们会漏播 diff 内容变化，
 * 选中文件的 diff 预览就会陈旧。按 status 报告的路径逐个 lstat，取 mtimeMs+size；
 * 单文件 stat 失败（已删除/瞬时竞态）记路径级哨兵；整批超时或容量不可用时
 * 返回全局哨兵，并由快照标记为不可靠。
 * porcelain 路径相对 repo 顶层，而 gitRoot 即订阅的顶层路径，可直接 join。
 */
export async function changedFilesStatSignal(
  gitRoot: string,
  statusOut: string,
  options: ChangedFilesStatSignalOptions = {}
): Promise<string> {
  const { files } = parseGitStatus(statusOut);
  if (files.length === 0) {
    return "";
  }
  const parts = new Array<string>(files.length);
  const stat = options.stat ?? lstat;
  let cursor = 0;
  let stopped = options.signal?.aborted === true;
  const outcome = await runChangedFileStatBatch(
    gitRoot,
    stat,
    async () => {
      await Promise.all(
        Array.from(
          {
            length: Math.min(CONTENT_SIGNAL_STAT_CONCURRENCY, files.length),
          },
          async () => {
            while (!stopped) {
              const index = cursor;
              cursor += 1;
              const file = files[index];
              if (!file) {
                return;
              }
              const probe = runChangedFileStatProbe(() =>
                stat(join(gitRoot, file.path))
              );
              if (!probe) {
                stopped = true;
                throw new Error(STAT_SIGNAL_UNAVAILABLE);
              }
              try {
                const fileStat = await probe;
                parts[index] =
                  `${file.path}\u0001${fileStat.mtimeMs}\u0001${fileStat.size}`;
              } catch {
                parts[index] = `${file.path}\u0001missing`;
              }
            }
          }
        )
      );
    },
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: options.timeoutMs ?? CONTENT_SIGNAL_STAT_TIMEOUT_MS,
    }
  );
  if (outcome === "unavailable") {
    stopped = true;
    return STAT_SIGNAL_UNAVAILABLE;
  }
  return parts.join("\u0002");
}

/** 一次签名计算期间捕获的原始 git 输出，供 getStatus 复用（A7）。 */
export interface RawWorktreeSnapshot {
  stagedNumstat: string;
  statusOut: string;
  unstagedNumstat: string;
}

export interface WorktreeSnapshot {
  readonly raw?: RawWorktreeSnapshot;
  readonly reliable: boolean;
  readonly signature: string;
}

type WorktreeExecGit = (
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal; timeoutMs?: number }
) => Promise<string>;

/**
 * worktree 签名：status porcelain(--branch) + numstat(unstaged/staged) +
 * 变更文件 stat 信号(mtimeMs+size)拼接后 hash。stat 信号补齐 porcelain 的内容盲区
 *（原 spec 缺口③）：已修改文件继续编辑但增删行数不变时，status/numstat 全文不变，
 * 唯 mtime/size 变——否则 diff 预览漏更新。
 * status、任一 numstat 或整批 stat 信号不可用时，快照标记 `reliable=false`。
 * 基线只记录该结果；后续每次刷新都保守广播，避免固定哨兵让更新永久静默。
 * 恢复成功后重新使用真实签名去重。
 *
 * status 带 --branch(A7)：输出成为 getStatus 所需严格超集；签名和原始三段由同一
 * 返回值绑定，避免同一 gitRoot 退订后立即重订时跨代共享邮箱串线。
 */
export async function defaultWorktreeSnapshot(
  gitRoot: string,
  exec: WorktreeExecGit = execGit,
  context?: GitWatchComputationContext
): Promise<WorktreeSnapshot> {
  let statusOut: string;
  try {
    statusOut = await exec(["status", "--porcelain=v2", "--branch", "-z"], {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    });
  } catch {
    return { reliable: false, signature: "" };
  }
  let unstagedFailed = false;
  let stagedFailed = false;
  const [unstaged, staged, statSignal] = await Promise.all([
    exec(["diff", "--numstat", "-z", "--no-renames"], {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    }).catch(() => {
      unstagedFailed = true;
      return NUMSTAT_ERROR_SENTINEL;
    }),
    exec(["diff", "--cached", "--numstat", "-z", "--no-renames"], {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    }).catch(() => {
      stagedFailed = true;
      return NUMSTAT_ERROR_SENTINEL;
    }),
    // 解析/整批 stat 失败不阻塞签名：写哨兵并把快照标为不可靠。
    changedFilesStatSignal(gitRoot, statusOut, {
      ...(context === undefined ? {} : { signal: context.signal }),
    }).catch(() => STAT_SIGNAL_UNAVAILABLE),
  ]);
  const raw =
    unstagedFailed || stagedFailed
      ? undefined
      : {
          stagedNumstat: staged,
          statusOut,
          unstagedNumstat: unstaged,
        };
  return {
    reliable:
      !(unstagedFailed || stagedFailed) &&
      statSignal !== STAT_SIGNAL_UNAVAILABLE,
    ...(raw === undefined ? {} : { raw }),
    signature: createHash("sha256")
      .update(`${statusOut}\0${unstaged}\0${staged}\0${statSignal}`)
      .digest("hex"),
  };
}

export async function defaultWorktreeSignature(
  gitRoot: string,
  execOrContext: WorktreeExecGit | GitWatchComputationContext = execGit
): Promise<string> {
  const exec = typeof execOrContext === "function" ? execOrContext : execGit;
  const context =
    typeof execOrContext === "function" ? undefined : execOrContext;
  return (await defaultWorktreeSnapshot(gitRoot, exec, context)).signature;
}

/**
 * refs 签名：与 repo hub 共享同一 `for-each-ref` 输出
 * （refname+oid+upstream+track+symref，见 git-refs-table.ts）。
 * 覆盖 fetch/push/prune/stash 纯 ref 操作、分支增删、upstream 配置与
 * gone 状态变化、refs/remotes/*​/HEAD 符号指向变化（A3）。
 */
export async function defaultRefsSignature(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<string> {
  const table = await fetchRefsTable(
    (args, cwd) =>
      execGit(args, {
        cwd,
        timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
        ...(context === undefined ? {} : { signal: context.signal }),
      }),
    gitRoot
  );
  return table === null ? "" : table.signature;
}

/**
 * repo hub 的 refs 快照：一次 for-each-ref 同时产出签名与共享 refs 表
 * （表供 upstreamGone / 默认分支解析 / merged 判定消费，消除重复 spawn）。
 */
export async function defaultRefsSnapshot(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<RefsSnapshot> {
  const table = await fetchRefsTable(
    (args, cwd) =>
      execGit(args, {
        cwd,
        timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
        ...(context === undefined ? {} : { signal: context.signal }),
      }),
    gitRoot
  );
  return table === null
    ? { signature: "" }
    : { signature: table.signature, table };
}

export async function defaultHeadSignature(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<string> {
  let head = "";
  let ref = "";
  try {
    head = await execGit(["rev-parse", "HEAD"], {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    });
  } catch {
    // 空仓库无 HEAD
  }
  try {
    ref = await execGit(["symbolic-ref", "-q", "HEAD"], {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    });
  } catch {
    // detached HEAD
  }
  return createHash("sha256").update(`${head}\n${ref}`).digest("hex");
}

async function fileExistsMark(
  path: string,
  mark: string,
  context?: GitWatchComputationContext
): Promise<string> {
  try {
    await watchAccess(path, context);
    return mark;
  } catch {
    return "";
  }
}

async function readFileTrim(
  path: string,
  context?: GitWatchComputationContext
): Promise<string> {
  try {
    return (await watchReadText(path, context)).trim();
  } catch {
    return "";
  }
}

const PATH_CACHE_MAX_ENTRIES = 128;

const gitDirCache = new GitWatchPathCache<string>(PATH_CACHE_MAX_ENTRIES);

async function gitMarker(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<string | null> {
  try {
    const stat = await watchLstat(join(gitRoot, ".git"), context);
    return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

async function readPathCache<T>(
  cache: GitWatchPathCache<T>,
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<T | undefined> {
  if (!cache.has(gitRoot)) {
    return;
  }
  const currentMarker = await gitMarker(gitRoot, context);
  if (currentMarker === null) {
    cache.delete(gitRoot);
    return;
  }
  return cache.get(gitRoot, currentMarker);
}

async function writePathCache<T>(
  cache: GitWatchPathCache<T>,
  gitRoot: string,
  value: T,
  context?: GitWatchComputationContext
): Promise<void> {
  const marker = await gitMarker(gitRoot, context);
  if (marker === null) {
    return;
  }
  cache.set(gitRoot, marker, value);
}

/** 最后一个 watcher 释放时清除路径身份，避免同路径重建仓库复用旧锚点。 */
export function invalidateGitWatchSignatureCaches(gitRoot?: string): void {
  if (gitRoot === undefined) {
    gitDirCache.clear();
    repoAnchorsCache.clear();
    return;
  }
  gitDirCache.delete(gitRoot);
  repoAnchorsCache.delete(gitRoot);
}

async function resolveGitDir(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<string | null> {
  const cached = await readPathCache(gitDirCache, gitRoot, context);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const out = await execGit(
      ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
      {
        cwd: gitRoot,
        timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
        ...(context === undefined ? {} : { signal: context.signal }),
      }
    );
    const gitDir = parseGitSinglePathOutput(out);
    if (gitDir !== null) {
      await writePathCache(gitDirCache, gitRoot, gitDir, context);
      return gitDir;
    }
    return null;
  } catch {
    return null;
  }
}

export async function defaultRepoStateSignature(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<string> {
  const gitDir = await resolveGitDir(gitRoot, context);
  if (gitDir === null) {
    return "";
  }
  const [merge, cherry, revert, bisect, rebaseMergeStep, rebaseApply] =
    await Promise.all([
      fileExistsMark(join(gitDir, "MERGE_HEAD"), "M", context),
      fileExistsMark(join(gitDir, "CHERRY_PICK_HEAD"), "C", context),
      fileExistsMark(join(gitDir, "REVERT_HEAD"), "R", context),
      fileExistsMark(join(gitDir, "BISECT_START"), "B", context),
      readFileTrim(join(gitDir, "rebase-merge", "msgnum"), context),
      fileExistsMark(join(gitDir, "rebase-apply"), "A", context),
    ]);
  // 用 hash 保签名短小；rebase 步进（msgnum 内容）折进 hash 让每步都触发广播
  return createHash("sha256")
    .update(
      `${merge}|${cherry}|${revert}|${bisect}|${rebaseMergeStep}|${rebaseApply}`
    )
    .digest("hex");
}

/** watch 拓扑的路径锚点：per-worktree gitDir + 物理仓 commonDir（hub key）。 */
export interface RepoAnchors {
  /** canonical（realpath 归一）git common dir——同仓多 worktree 的去重键。 */
  commonDir: string;
  /** 本 worktree 的 gitDir（realpath 归一，供 hub 的 worktrees/<name> 事件路由匹配）。 */
  gitDir: string;
}

/** 锚点缓存（worktree 生命周期内稳定）。失败不缓存：瞬时故障下一次重试。 */
const repoAnchorsCache = new GitWatchPathCache<RepoAnchors>(
  PATH_CACHE_MAX_ENTRIES
);

export async function resolveRepoAnchors(
  gitRoot: string,
  context?: GitWatchComputationContext
): Promise<RepoAnchors | null> {
  const cached = await readPathCache(repoAnchorsCache, gitRoot, context);
  if (cached !== undefined) {
    return cached;
  }
  let rawGitDir: string | null;
  let rawCommonDir: string | null;
  try {
    const options = {
      cwd: gitRoot,
      timeoutMs: GIT_WATCH_COMMAND_TIMEOUT_MS,
      ...(context === undefined ? {} : { signal: context.signal }),
    };
    const [gitDirOutput, commonDirOutput] = await Promise.all([
      execGit(
        ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
        options
      ),
      execGit(
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        options
      ),
    ]);
    rawGitDir = parseGitSinglePathOutput(gitDirOutput);
    rawCommonDir = parseGitSinglePathOutput(commonDirOutput);
  } catch {
    return null;
  }
  if (rawGitDir === null) {
    return null;
  }
  rawCommonDir ??= rawGitDir;
  // realpath 归一：macOS /var → /private/var 等 symlink 会破坏
  // gitDir 与 commonDir 的字符串前缀关系（hub 事件路由依赖它）
  let gitDir = rawGitDir;
  let commonDir = rawCommonDir;
  try {
    [gitDir, commonDir] = await Promise.all([
      watchRealpath(rawGitDir, context),
      watchRealpath(rawCommonDir, context),
    ]);
  } catch {
    // realpath 失败（路径消失等）：退回原始绝对路径
  }
  const anchors: RepoAnchors = { commonDir, gitDir };
  await writePathCache(repoAnchorsCache, gitRoot, anchors, context);
  return anchors;
}
