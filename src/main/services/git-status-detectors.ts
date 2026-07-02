import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitDelta, GitRepoState } from "../../shared/contracts/git.ts";
import { GitExecError } from "./git-exec.ts";
import { parseGitNumstat } from "./git-parsers.ts";

/** git-service.ts 注入进来；测试可传 fake。 */
export type ExecGitFn = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 数 `.git/BISECT_LOG` 里 good/bad 记录数。log 行例：
 *   `# good: [<sha>] <subject>` / `# bad: [<sha>] <subject>` / `git bisect good/bad <sha>`
 * 只识别命令行（`git bisect (good|bad) `），comment 行忽略。
 */
function countBisectMarks(log: string): { bad: number; good: number } {
  let good = 0;
  let bad = 0;
  for (const raw of log.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("git bisect good ")) {
      good += 1;
    } else if (line.startsWith("git bisect bad ")) {
      bad += 1;
    }
  }
  return { bad, good };
}

async function readIntFile(path: string): Promise<number | null> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * 检测仓库特殊态。优先级 bisecting > rebasing > merging > cherry-picking > reverting > clean。
 * 每种态互斥（git 保证）；命中第一个就返回。
 * conflictCount 由调用方从 files 派生传入，避免本函数再拉 status。
 */
export async function detectRepoState(
  gitDir: string,
  conflictCount: number
): Promise<GitRepoState> {
  const [
    bisectExists,
    rebaseMergeExists,
    rebaseApplyExists,
    mergeExists,
    cherryExists,
    revertExists,
  ] = await Promise.all([
    fileExists(join(gitDir, "BISECT_START")),
    fileExists(join(gitDir, "rebase-merge")),
    fileExists(join(gitDir, "rebase-apply")),
    fileExists(join(gitDir, "MERGE_HEAD")),
    fileExists(join(gitDir, "CHERRY_PICK_HEAD")),
    fileExists(join(gitDir, "REVERT_HEAD")),
  ]);

  if (bisectExists) {
    const log = await readFile(join(gitDir, "BISECT_LOG"), "utf8").catch(
      () => ""
    );
    const { good, bad } = countBisectMarks(log);
    return { bad, good, kind: "bisecting" };
  }

  if (rebaseMergeExists || rebaseApplyExists) {
    const rebaseDir = rebaseMergeExists
      ? join(gitDir, "rebase-merge")
      : join(gitDir, "rebase-apply");
    // rebase-apply 用 next/last 两个文件；rebase-merge 用 msgnum/end
    const [msgnum, end, next, last] = await Promise.all([
      readIntFile(join(rebaseDir, "msgnum")),
      readIntFile(join(rebaseDir, "end")),
      readIntFile(join(rebaseDir, "next")),
      readIntFile(join(rebaseDir, "last")),
    ]);
    const current = msgnum ?? next ?? 0;
    const total = end ?? last ?? 0;
    return { conflictCount, current, kind: "rebasing", total };
  }

  if (mergeExists) {
    return { conflictCount, kind: "merging" };
  }

  if (cherryExists) {
    return { conflictCount, kind: "cherry-picking" };
  }

  if (revertExists) {
    return { conflictCount, kind: "reverting" };
  }

  return { kind: "clean" };
}

/** getLineDelta 可复用的预取 numstat 原始输出（A7）。 */
export interface PrefetchedNumstat {
  stagedNumstat: string;
  unstagedNumstat: string;
}

/**
 * 汇总当前 worktree 的行级增删（staged + unstaged）。binary 文件不计入。
 * 任一 diff 失败返回 null（非致命，UI 层降级显示）。
 * 提供 prefetched 时直接解析已有输出，跳过两条 numstat spawn（A7）。
 */
export async function getLineDelta(
  execGit: ExecGitFn,
  cwd: string,
  prefetched?: PrefetchedNumstat
): Promise<GitDelta | null> {
  try {
    let unstagedOut: string;
    let stagedOut: string;
    if (prefetched === undefined) {
      [unstagedOut, stagedOut] = await Promise.all([
        execGit(["diff", "--numstat", "-z", "--no-renames"], cwd),
        execGit(["diff", "--cached", "--numstat", "-z", "--no-renames"], cwd),
      ]);
    } else {
      unstagedOut = prefetched.unstagedNumstat;
      stagedOut = prefetched.stagedNumstat;
    }
    const stats = [
      ...parseGitNumstat(unstagedOut),
      ...parseGitNumstat(stagedOut),
    ];
    return {
      deletions: stats.reduce((sum, stat) => sum + stat.deletions, 0),
      insertions: stats.reduce((sum, stat) => sum + stat.insertions, 0),
    };
  } catch {
    return null;
  }
}

/**
 * Stash 数。`rev-list --walk-reflogs --count refs/stash` 快过 `stash list | wc -l`（不 fork bash）。
 * refs/stash 不存在时 execGit 会拒绝 → catch 后返回 0。
 */
export async function getStashCount(
  execGit: ExecGitFn,
  cwd: string
): Promise<number> {
  try {
    const out = await execGit(
      ["rev-list", "--walk-reflogs", "--count", "refs/stash"],
      cwd
    );
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * 判断当前分支的 upstream 是否已 gone（远端 ref 已删）。
 * `for-each-ref --format=%(upstream:track) refs/heads/<branch>` 输出含 `[gone]` 即为 true。
 * branch 为 null（detached HEAD）时直接返回 false。
 */
export async function detectUpstreamGone(
  execGit: ExecGitFn,
  cwd: string,
  branch: string | null
): Promise<boolean> {
  if (branch === null || branch.length === 0) {
    return false;
  }
  try {
    const out = await execGit(
      ["for-each-ref", "--format=%(upstream:track)", `refs/heads/${branch}`],
      cwd
    );
    return out.includes("[gone]");
  } catch {
    return false;
  }
}

/**
 * 默认分支 remote-tracking ref 缓存（key: gitCommonDir）。
 * TTL 5 分钟；过期视为 miss 重新探测。解析为 null 时**不写缓存**，
 * 让每次调用重探一次（新建 origin/HEAD 后能立即生效），成本一个子进程可接受。
 */
const DEFAULT_BRANCH_REF_TTL_MS = 5 * 60_000;

interface DefaultBranchRefCacheEntry {
  at: number;
  ref: string;
}

const defaultBranchRefCache = new Map<string, DefaultBranchRefCacheEntry>();

export function clearDefaultBranchRefCacheForTests(): void {
  defaultBranchRefCache.clear();
}

/**
 * 从 `refs/remotes/*​/HEAD` 枚举默认分支 remote-tracking ref。
 * 多远端时 origin 优先，否则取第一条 symref 非空的条目。
 * 返回完整 symref target（如 `refs/remotes/upstream/main`）；无则 null。
 */
export async function resolveDefaultBranchRef(
  execGit: ExecGitFn,
  cwd: string,
  gitCommonDir: string,
  now: () => number = Date.now
): Promise<string | null> {
  const cached = defaultBranchRefCache.get(gitCommonDir);
  if (cached !== undefined && now() - cached.at < DEFAULT_BRANCH_REF_TTL_MS) {
    return cached.ref;
  }
  const ref = await probeDefaultBranchRef(execGit, cwd);
  if (ref === null) {
    // null 不缓存：下次调用重探，新建的 origin/HEAD 能立即被发现。
    defaultBranchRefCache.delete(gitCommonDir);
    return null;
  }
  defaultBranchRefCache.set(gitCommonDir, { at: now(), ref });
  return ref;
}

async function probeDefaultBranchRef(
  execGit: ExecGitFn,
  cwd: string
): Promise<string | null> {
  let output: string;
  try {
    output = await execGit(
      [
        "for-each-ref",
        "--format=%(refname)%00%(symref)",
        "refs/remotes/*/HEAD",
      ],
      cwd
    );
  } catch {
    return null;
  }
  let fallback: string | null = null;
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [refname = "", symref = ""] = line.split("\0");
    if (symref.length === 0 || !symref.startsWith("refs/remotes/")) {
      continue;
    }
    if (refname === "refs/remotes/origin/HEAD") {
      return symref; // origin 优先
    }
    fallback ??= symref;
  }
  return fallback;
}

/**
 * 从 `refs/remotes/<remote>/<name>` 剥离出分支名 `<name>`（保留带斜杠分支名）。
 * 前两段固定为 refs/remotes，第三段是 remote 名。
 */
function branchNameFromRemoteRef(remoteRef: string): string {
  return remoteRef.split("/").slice(3).join("/");
}

/**
 * HEAD 是否已是默认分支 remote-tracking ref 的祖先。
 * merge-base --is-ancestor: exit 0 = 是，exit 1 = 否，其余（如 ref 不存在）= null。
 * squash merge 检测不到（commit 被重写）——spec 已知限制。
 */
export async function detectMergedIntoDefault(
  execGit: ExecGitFn,
  cwd: string,
  branch: string | null,
  gitCommonDir: string
): Promise<boolean | null> {
  if (branch === null || branch.length === 0) {
    return null;
  }
  const defaultRef = await resolveDefaultBranchRef(execGit, cwd, gitCommonDir);
  if (defaultRef === null) {
    return null;
  }
  if (branchNameFromRemoteRef(defaultRef) === branch) {
    return null;
  }
  try {
    await execGit(["merge-base", "--is-ancestor", "HEAD", defaultRef], cwd);
    return true;
  } catch (error) {
    if (error instanceof GitExecError && error.exitCode === 1) {
      return false;
    }
    return null;
  }
}
