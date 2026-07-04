import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitDelta, GitRepoState } from "../../shared/contracts/git.ts";
import { GitExecError } from "./git-exec.ts";
import { parseGitNumstat } from "./git-parsers.ts";
import type { DefaultBranchCandidates } from "./git-refs-table.ts";

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
 * merged 判定 memo。key = `${headOid}:${tipOid}`：commit oid 哈希覆盖全部祖先，
 * 两个 oid 即唯一决定图关系，跨仓库全局成立、永不过期；上界防无限增长。
 */
const MERGED_MEMO_MAX = 512;
const mergedMemo = new Map<string, boolean>();

export function clearMergedMemoForTests(): void {
  mergedMemo.clear();
}

function memoizeMerged(key: string, value: boolean): boolean {
  if (mergedMemo.size >= MERGED_MEMO_MAX) {
    const oldest = mergedMemo.keys().next().value;
    if (oldest !== undefined) {
      mergedMemo.delete(oldest);
    }
  }
  mergedMemo.set(key, value);
  return value;
}

/** cherry 补充判定的规模上界：超界跳过 cherry，按图判据结果返回（成本有界）。 */
const CHERRY_OWN_MAX = 32;
const CHERRY_BEHIND_MAX = 2000;

/** merge-base --is-ancestor：exit 0 = 是，exit 1 = 否，其余（ref 失效等）= null。 */
async function isAncestor(
  execGit: ExecGitFn,
  cwd: string,
  headOid: string,
  tipOid: string
): Promise<boolean | null> {
  try {
    await execGit(["merge-base", "--is-ancestor", headOid, tipOid], cwd);
    return true;
  } catch (error) {
    if (error instanceof GitExecError && error.exitCode === 1) {
      return false;
    }
    return null;
  }
}

/**
 * HEAD 已是 tip 祖先时，判定它是否经 merge commit 汇入（而非"本来就在主链上"）。
 * `rev-list --first-parent --parents tip --not HEAD` 输出每行 `<commit> <第一父> ...`：
 * HEAD 以某条链上提交的**第一父**身份出现 ⇔ HEAD 在 first-parent 主链上
 * （新建 worktree / ff 合并场景，判 false）；从未以第一父出现 ⇔ 经 merge commit
 * 的侧支汇入（判 true）。排除侧让遍历停在 HEAD 可达域边界，成本 ∝ 分叉距离。
 * 注意不能用 `--boundary`：merge commit 的第二父也会进 boundary 集，无判别力。
 */
async function mergedViaMergeCommit(
  execGit: ExecGitFn,
  cwd: string,
  headOid: string,
  tipOid: string
): Promise<boolean> {
  const out = await execGit(
    ["rev-list", "--first-parent", "--parents", tipOid, "--not", headOid],
    cwd
  );
  let sawChain = false;
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    sawChain = true;
    if (line.split(" ")[1] === headOid) {
      return false;
    }
  }
  return sawChain;
}

/**
 * HEAD 不是 tip 祖先时的补充判定：own 提交全部 patch 等价于上游
 * （`git cherry` 全 `-`）⇒ rebase-merge / 单提交 squash 已合入。
 * 多提交 squash（N 压 1）patch-id 对不上，仍检测不到——已知限制，
 * 只有 PR API 集成能彻底解决。
 */
async function mergedViaCherry(
  execGit: ExecGitFn,
  cwd: string,
  headOid: string,
  tipOid: string
): Promise<boolean> {
  let own = 0;
  let behind = 0;
  try {
    const [ownRaw, behindRaw] = await Promise.all([
      execGit(["rev-list", "--count", `${tipOid}..${headOid}`], cwd),
      execGit(["rev-list", "--count", `${headOid}..${tipOid}`], cwd),
    ]);
    own = Number(ownRaw.trim());
    behind = Number(behindRaw.trim());
  } catch {
    return false;
  }
  if (!(Number.isFinite(own) && Number.isFinite(behind))) {
    return false;
  }
  if (own === 0 || own > CHERRY_OWN_MAX || behind > CHERRY_BEHIND_MAX) {
    return false;
  }
  try {
    const cherry = await execGit(["cherry", tipOid, headOid], cwd);
    const lines = cherry.split("\n").filter((line) => line.length > 0);
    return lines.length > 0 && lines.every((line) => line.startsWith("-"));
  } catch {
    return false;
  }
}

/** 对单个默认分支候选 tip 的 merged 判定；错误不写 memo（瞬时故障可重试）。 */
async function mergedIntoTip(
  execGit: ExecGitFn,
  cwd: string,
  headOid: string,
  tipOid: string
): Promise<boolean> {
  if (tipOid.length === 0 || tipOid === headOid) {
    // tip 与 HEAD 相同：无自有提交（fresh worktree / ff 后），图上无合并痕迹
    return false;
  }
  const key = `${headOid}:${tipOid}`;
  const cached = mergedMemo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const ancestor = await isAncestor(execGit, cwd, headOid, tipOid);
  if (ancestor === null) {
    return false;
  }
  const merged = ancestor
    ? await mergedViaMergeCommit(execGit, cwd, headOid, tipOid)
    : await mergedViaCherry(execGit, cwd, headOid, tipOid);
  return memoizeMerged(key, merged);
}

/**
 * 分支工作是否已合入默认分支。核心判据：HEAD 是默认分支 tip 的祖先**且**
 * 不在其 first-parent 主链上（即经 merge commit 汇入）；非祖先时用 cherry
 * patch 等价覆盖 rebase-merge / 单提交 squash。remote-tracking tip 与同名
 * 本地分支 tip 任一命中即 true（覆盖"本地合并未 push"窗口期）。
 * null = 不适用：detached / 空仓库 / 无默认分支 / 自身就是默认分支。
 */
export async function detectMergedIntoDefault(
  execGit: ExecGitFn,
  cwd: string,
  branch: string | null,
  headOid: string | null,
  candidates: DefaultBranchCandidates
): Promise<boolean | null> {
  if (branch === null || branch.length === 0) {
    return null;
  }
  if (headOid === null || headOid.length === 0) {
    return null;
  }
  const { remote, local } = candidates;
  const defaultName = remote?.branchName ?? local?.branchName;
  if (defaultName === undefined) {
    return null;
  }
  if (defaultName === branch) {
    return null;
  }
  for (const tip of [remote, local]) {
    if (tip === null) {
      continue;
    }
    if (await mergedIntoTip(execGit, cwd, headOid, tip.oid)) {
      return true;
    }
  }
  return false;
}
