import { GitExecError } from "./git-exec.ts";
import type {
  DefaultBranchCandidate,
  DefaultBranchCandidates,
} from "./git-refs-table.ts";

type ExecGitFn = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

/**
 * merged 判定 memo。普通图关系由 branch/head/tip 决定。ff 补充判据依赖
 * 分支 reflog 的当前实例，不能用同一组 oid 缓存；否则同名分支删除重建后会
 * 复用旧结果。所以下方只缓存非 ff 歧义路径。
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
const REFLOG_ENTRY_FORMAT = "--format=%ct%x00%H%x00%gs";

interface ReflogEntry {
  message: string;
  oid: string;
  timestamp: number;
}

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
 * HEAD 以某条链上提交的第一父身份出现 ⇔ HEAD 在 first-parent 主链上
 * （新建分支 / 无自有提交落后场景，判 false）；从未以第一父出现 ⇔ 经 merge commit
 * 的侧支汇入（判 true）。排除侧让遍历停在 HEAD 可达域边界，成本 ∝ 分叉距离。
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

function parseReflogEntries(output: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [timestampRaw = "", oid = "", message = ""] = line.split("\0");
    const timestamp = Number(timestampRaw);
    if (!(Number.isFinite(timestamp) && oid.length > 0)) {
      continue;
    }
    entries.push({ message, oid, timestamp });
  }
  return entries;
}

function shortNameFromRef(refname: string): string | null {
  if (refname.startsWith("refs/remotes/")) {
    return refname.split("/").slice(2).join("/");
  }
  if (refname.startsWith("refs/heads/")) {
    return refname.split("/").slice(2).join("/");
  }
  return null;
}

function remoteNameFromRef(refname: string): string | null {
  if (!refname.startsWith("refs/remotes/")) {
    return null;
  }
  return refname.split("/")[2] ?? null;
}

function mergeBranchNamesFor(
  branch: string,
  candidates: DefaultBranchCandidates,
  branchUpstream: string | null | undefined
): readonly string[] {
  const names = new Set<string>([branch, `refs/heads/${branch}`]);
  if (branchUpstream && branchUpstream.length > 0) {
    names.add(branchUpstream);
    names.add(shortNameFromRef(branchUpstream) ?? branchUpstream);
  }
  const defaultRemoteName =
    candidates.remote === null
      ? null
      : remoteNameFromRef(candidates.remote.refname);
  if (defaultRemoteName !== null) {
    names.add(`${defaultRemoteName}/${branch}`);
  }
  return [...names].sort();
}

function isFastForwardMergeReflogEntry(
  entry: ReflogEntry,
  headOid: string,
  mergeBranchNames: readonly string[]
): boolean {
  return (
    entry.oid === headOid &&
    entry.message.includes("Fast-forward") &&
    mergeBranchNames.some((name) => entry.message.startsWith(`merge ${name}:`))
  );
}

function branchHeadReachedEvidence(
  entries: readonly ReflogEntry[],
  headOid: string
): { hasEarlierDistinctOid: boolean; timestamp: number } | null {
  const reachedIndex = entries.findIndex((entry) => entry.oid === headOid);
  if (reachedIndex < 0) {
    return null;
  }
  return {
    hasEarlierDistinctOid: entries
      .slice(reachedIndex + 1)
      .some((entry) => entry.oid !== headOid),
    timestamp: entries[reachedIndex]?.timestamp ?? 0,
  };
}

function reflogEntryIsAfterBranchReachedHead(
  entry: ReflogEntry,
  branchEvidence: { hasEarlierDistinctOid: boolean; timestamp: number }
): boolean {
  if (entry.timestamp > branchEvidence.timestamp) {
    return true;
  }
  return (
    entry.timestamp === branchEvidence.timestamp &&
    branchEvidence.hasEarlierDistinctOid
  );
}

/**
 * ff 合并后 source branch 与默认分支同 tip，commit graph 无法区分：
 * - feature 提交被 main fast-forward 到同一个 oid
 * - 用户刚从 main 当前 tip 新建一个空 feature branch
 *
 * 只能用本地默认分支 reflog 作为补充证据；没有证据时保守返回 false。
 */
async function mergedViaFastForwardReflog(
  execGit: ExecGitFn,
  cwd: string,
  branch: string,
  headOid: string,
  mergeBranchNames: readonly string[],
  tip: DefaultBranchCandidate
): Promise<boolean> {
  try {
    const defaultReflogOut = await execGit(
      ["reflog", "show", REFLOG_ENTRY_FORMAT, tip.refname],
      cwd
    );
    const matchingDefaultEntries = parseReflogEntries(defaultReflogOut).filter(
      (entry) => isFastForwardMergeReflogEntry(entry, headOid, mergeBranchNames)
    );
    if (matchingDefaultEntries.length === 0) {
      return false;
    }
    const branchReflogOut = await execGit(
      ["reflog", "show", REFLOG_ENTRY_FORMAT, `refs/heads/${branch}`],
      cwd
    );
    const branchEvidence = branchHeadReachedEvidence(
      parseReflogEntries(branchReflogOut),
      headOid
    );
    if (branchEvidence === null) {
      return false;
    }
    return matchingDefaultEntries.some((entry) =>
      reflogEntryIsAfterBranchReachedHead(entry, branchEvidence)
    );
  } catch {
    return false;
  }
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
  repoKey: string,
  branch: string,
  headOid: string,
  mergeBranchNames: readonly string[],
  tip: DefaultBranchCandidate
): Promise<boolean> {
  if (tip.oid.length === 0) {
    return false;
  }
  if (tip.oid === headOid) {
    const ancestor = await isAncestor(execGit, cwd, headOid, tip.oid);
    if (ancestor !== true) {
      return false;
    }
    return mergedViaFastForwardReflog(
      execGit,
      cwd,
      branch,
      headOid,
      mergeBranchNames,
      tip
    );
  }
  const key = `${repoKey}:${branch}:${headOid}:${tip.refname}:${tip.oid}:${mergeBranchNames.join(",")}`;
  const cached = mergedMemo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const ancestor = await isAncestor(execGit, cwd, headOid, tip.oid);
  if (ancestor === null) {
    return false;
  }
  let merged: boolean;
  if (ancestor) {
    merged = await mergedViaMergeCommit(execGit, cwd, headOid, tip.oid);
  } else {
    merged = await mergedViaCherry(execGit, cwd, headOid, tip.oid);
  }
  return memoizeMerged(key, merged);
}

/**
 * 分支工作是否已合入默认分支。核心判据：merge commit 的侧支证据；
 * 非祖先时用 cherry patch 等价覆盖 rebase-merge / 单提交 squash；
 * ff 合并用本地默认分支 reflog 补充。remote-tracking tip 与同名本地
 * 分支 tip 任一命中即 true（覆盖"本地合并未 push"窗口期）。
 * null = 不适用：detached / 空仓库 / 无默认分支 / 自身就是默认分支。
 */
export async function detectMergedIntoDefault(
  execGit: ExecGitFn,
  cwd: string,
  branch: string | null,
  headOid: string | null,
  candidates: DefaultBranchCandidates,
  branchUpstream?: string | null
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
  const repoKey = cwd;
  const mergeBranchNames = mergeBranchNamesFor(
    branch,
    candidates,
    branchUpstream
  );
  for (const tip of [remote, local]) {
    if (tip === null) {
      continue;
    }
    if (
      await mergedIntoTip(
        execGit,
        cwd,
        repoKey,
        branch,
        headOid,
        mergeBranchNames,
        tip
      )
    ) {
      return true;
    }
  }
  return false;
}
