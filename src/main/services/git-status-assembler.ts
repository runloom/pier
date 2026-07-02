import type { GitStatus } from "../../shared/contracts/git.ts";
import {
  deriveCounts,
  parseGitStatus,
  splitNonEmptyLines,
} from "./git-parsers.ts";
import {
  detectMergedIntoDefault,
  detectRepoState,
  detectUpstreamGone,
  type ExecGitFn,
  getLineDelta,
  getStashCount,
} from "./git-status-detectors.ts";

/**
 * getStatus 可复用的预取原始输出（A7）：来自 watch service 本轮签名计算。
 * 提供时跳过自身的 status 与两条 numstat spawn；其余命令照跑。
 * statusOut 含 `--branch` 头，parseGitStatus 本就解析它。
 */
export interface PrefetchedStatus {
  stagedNumstat: string;
  statusOut: string;
  unstagedNumstat: string;
}

/**
 * 组装完整 GitStatus。从 git-service.getStatus 拆出（file-size 上限 + A7 预取复用）。
 * 状态唯一来源仍是此函数；watch 广播是唯一推送通道。
 */
export async function assembleGitStatus(
  execGit: ExecGitFn,
  cwd: string,
  prefetched?: PrefetchedStatus
): Promise<GitStatus> {
  // wave 1：可并发的独立 op（status 输出 + 增删 + stash + gitDir/gitCommonDir 解析）
  const [statusOut, delta, stashCount, gitDirOut] = await Promise.all([
    prefetched === undefined
      ? execGit(["status", "--porcelain=v2", "--branch", "-z"], cwd)
      : Promise.resolve(prefetched.statusOut),
    getLineDelta(
      execGit,
      cwd,
      prefetched === undefined
        ? undefined
        : {
            stagedNumstat: prefetched.stagedNumstat,
            unstagedNumstat: prefetched.unstagedNumstat,
          }
    ),
    getStashCount(execGit, cwd),
    execGit(
      [
        "rev-parse",
        "--path-format=absolute",
        "--absolute-git-dir",
        "--git-common-dir",
      ],
      cwd
    ),
  ]);
  const parsed = parseGitStatus(statusOut);
  const counts = deriveCounts(parsed.files);
  // wave 2：依赖 wave 1 的派生值（gitDir + conflictCount / branch 名 / gitCommonDir）
  const dirLines = splitNonEmptyLines(gitDirOut);
  const gitDir = dirLines[0] ?? "";
  const gitCommonDir = dirLines[1] ?? gitDir;
  const branchName = parsed.branch.branch;
  const [repoState, upstreamGone, mergedIntoDefault] = await Promise.all([
    detectRepoState(gitDir, counts.conflict),
    detectUpstreamGone(execGit, cwd, branchName),
    detectMergedIntoDefault(execGit, cwd, branchName, gitCommonDir),
  ]);
  return {
    branch: {
      ahead: parsed.branch.ahead,
      behind: parsed.branch.behind,
      branch: parsed.branch.branch,
      mergedIntoDefault,
      oid: parsed.branch.oid,
      upstream: parsed.branch.upstream,
      upstreamGone,
    },
    counts,
    delta,
    files: parsed.files,
    repoState,
    stashCount,
  };
}
