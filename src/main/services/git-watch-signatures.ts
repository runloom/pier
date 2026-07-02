import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execGit } from "./git-exec.ts";

/**
 * numstat 瞬时失败（如 index.lock）时写入签名的哨兵段。
 * 与任何真实 numstat 输出（含空串）都不同：从成功态进入失败态会广播一次，
 * 恢复成功后再广播一次真实值；连续失败之间签名一致不重复广播。
 */
const NUMSTAT_ERROR_SENTINEL = "numstat-unavailable";

/** 一次签名计算期间捕获的原始 git 输出，供 getStatus 复用（A7）。 */
export interface RawWorktreeSnapshot {
  stagedNumstat: string;
  statusOut: string;
  unstagedNumstat: string;
}

/**
 * 默认 defaultWorktreeSignature 路径每轮把原始输出写这里，供 refresh 传给 getStatus 复用，
 * 消除"一次变化重复 spawn status/numstat"。仅默认实现填充；注入替身时为空。
 * 模块级：同一 gitRoot 只有一个默认签名计算路径在跑（refresh 已串行化，A6）。
 */
const lastRawByRoot = new Map<string, RawWorktreeSnapshot>();

/** refresh 取用后消费掉快照，避免陈旧数据被后续（非本轮）getStatus 误用。 */
export function takeRawWorktreeSnapshot(
  gitRoot: string
): RawWorktreeSnapshot | undefined {
  const snapshot = lastRawByRoot.get(gitRoot);
  if (snapshot !== undefined) {
    lastRawByRoot.delete(gitRoot);
  }
  return snapshot;
}

type WorktreeExecGit = (
  args: readonly string[],
  options: { cwd: string }
) => Promise<string>;

/**
 * worktree 签名：status porcelain(--branch) + numstat(unstaged/staged)拼接后 hash。
 * porcelain v2 不含工作区内容 oid，已修改文件继续编辑时只有 numstat 会变(spec 缺口③)。
 * status 失败仍整体返回 ""(保持旧语义)；numstat 瞬时失败写哨兵段(A4)——失败与任何真实输出
 * 都不同，从成功态进入失败态广播一次、恢复后再广播真实值，连续失败之间不重复广播。
 *
 * status 带 --branch(A7)：输出成为 getStatus 所需严格超集，原始三段写入 lastRawByRoot
 * 供本轮 getStatus 复用(仅默认 exec 路径填充；注入 exec 时不写)。
 */
export async function defaultWorktreeSignature(
  gitRoot: string,
  exec: WorktreeExecGit = execGit
): Promise<string> {
  const isDefaultExec = exec === execGit;
  let statusOut: string;
  try {
    statusOut = await exec(["status", "--porcelain=v2", "--branch", "-z"], {
      cwd: gitRoot,
    });
  } catch {
    lastRawByRoot.delete(gitRoot);
    return "";
  }
  let unstagedFailed = false;
  let stagedFailed = false;
  const [unstaged, staged] = await Promise.all([
    exec(["diff", "--numstat", "-z", "--no-renames"], { cwd: gitRoot }).catch(
      () => {
        unstagedFailed = true;
        return NUMSTAT_ERROR_SENTINEL;
      }
    ),
    exec(["diff", "--cached", "--numstat", "-z", "--no-renames"], {
      cwd: gitRoot,
    }).catch(() => {
      stagedFailed = true;
      return NUMSTAT_ERROR_SENTINEL;
    }),
  ]);
  // 只有默认 exec 路径、且三段都是真实输出时，缓存原始快照供 getStatus 复用。
  if (isDefaultExec && !(unstagedFailed || stagedFailed)) {
    lastRawByRoot.set(gitRoot, {
      stagedNumstat: staged,
      statusOut,
      unstagedNumstat: unstaged,
    });
  } else {
    lastRawByRoot.delete(gitRoot);
  }
  return createHash("sha256")
    .update(`${statusOut}\0${unstaged}\0${staged}`)
    .digest("hex");
}

/**
 * refs 签名：refs/heads + refs/remotes + refs/stash 的 refname+oid+upstream+symref。
 * 覆盖 fetch/push/prune/stash 纯 ref 操作、分支增删、upstream 配置变化（set/unset-upstream），
 * 以及 refs/remotes/*​/HEAD 符号指向变化（如 remote set-head 改默认分支，A3）。
 */
export async function defaultRefsSignature(gitRoot: string): Promise<string> {
  try {
    const output = await execGit(
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)",
        "refs/heads",
        "refs/remotes",
        "refs/stash",
      ],
      { cwd: gitRoot }
    );
    return createHash("sha256").update(output).digest("hex");
  } catch {
    return "";
  }
}

export async function defaultHeadSignature(gitRoot: string): Promise<string> {
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

export async function defaultRepoStateSignature(
  gitRoot: string
): Promise<string> {
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
