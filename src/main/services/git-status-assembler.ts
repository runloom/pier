import type { GitStatus } from "../../shared/contracts/git.ts";
import {
  buildGitChangeSummary,
  GIT_STATUS_ARGS,
  GIT_WORKING_TREE_NUMSTAT_ARGS,
  gitChangeSummaryCommandFailureReason,
} from "./git-change-summary.ts";
import { detectMergedIntoDefault } from "./git-merged-detector.ts";
import {
  deriveCounts,
  parseGitStatus,
  splitNonEmptyLines,
} from "./git-parsers.ts";
import {
  defaultBranchCandidates,
  fetchRefsTable,
  type RefsTable,
  upstreamGoneFor,
} from "./git-refs-table.ts";
import { getRemoteSync } from "./git-remote-sync-registry.ts";
import {
  detectRepoState,
  type ExecGitFn,
  getStashCount,
} from "./git-status-detectors.ts";

/**
 * getStatus 可复用的预取数据（A7）：raw 输出来自 watch service 本轮签名计算，
 * refsTable 来自 repo hub 的共享 refs 表（同轮 for-each-ref 解析结果）。
 * 提供时跳过自身的 status / numstat / for-each-ref spawn；其余命令照跑。
 * statusOut 含 `--branch` 头，parseGitStatus 本就解析它。
 */
export interface PrefetchedStatus {
  refsTable?: RefsTable;
  statusOut: string;
  workingTreeNumstat: string;
}

interface ConsistentStatusSnapshot {
  readonly statusOut: string;
  readonly unavailableReason?: "commandFailed" | "inconsistent" | "timeout";
  readonly workingTreeNumstat: string;
}

async function readConsistentStatusSnapshot(
  execGit: ExecGitFn,
  cwd: string
): Promise<ConsistentStatusSnapshot> {
  const statusBefore = await execGit(GIT_STATUS_ARGS, cwd);
  const hasHead = parseGitStatus(statusBefore).branch.oid !== null;
  let numstatBefore = "";
  try {
    if (hasHead)
      numstatBefore = await execGit(
        [...GIT_WORKING_TREE_NUMSTAT_ARGS, "HEAD"],
        cwd
      );
  } catch (error) {
    return {
      statusOut: statusBefore,
      unavailableReason: gitChangeSummaryCommandFailureReason(error),
      workingTreeNumstat: "",
    };
  }
  const statusAfter = await execGit(GIT_STATUS_ARGS, cwd);
  if (statusBefore !== statusAfter) {
    return {
      statusOut: statusAfter,
      unavailableReason: "inconsistent",
      workingTreeNumstat: numstatBefore,
    };
  }
  let numstatAfter = "";
  try {
    if (hasHead)
      numstatAfter = await execGit(
        [...GIT_WORKING_TREE_NUMSTAT_ARGS, "HEAD"],
        cwd
      );
  } catch (error) {
    return {
      statusOut: statusAfter,
      unavailableReason: gitChangeSummaryCommandFailureReason(error),
      workingTreeNumstat: numstatBefore,
    };
  }
  return {
    statusOut: statusAfter,
    ...(numstatBefore === numstatAfter
      ? {}
      : { unavailableReason: "inconsistent" as const }),
    workingTreeNumstat: numstatAfter,
  };
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
  const statusSnapshotPromise: Promise<ConsistentStatusSnapshot> =
    prefetched === undefined
      ? readConsistentStatusSnapshot(execGit, cwd)
      : Promise.resolve({
          statusOut: prefetched.statusOut,
          workingTreeNumstat: prefetched.workingTreeNumstat,
        });
  // wave 1：可并发的独立 op（status 输出 + stash + gitDir 解析 + refs 表）
  const [statusSnapshot, stashCount, gitDirOut, refsTable] = await Promise.all([
    statusSnapshotPromise,
    getStashCount(execGit, cwd),
    execGit(["rev-parse", "--path-format=absolute", "--absolute-git-dir"], cwd),
    prefetched?.refsTable === undefined
      ? fetchRefsTable(execGit, cwd)
      : Promise.resolve(prefetched.refsTable),
  ]);
  const statusOut = statusSnapshot.statusOut;
  const parsed = parseGitStatus(statusOut);
  const counts = deriveCounts(parsed.files);
  const changeSummary = await buildGitChangeSummary({
    cwd,
    execGit,
    files: parsed.files,
    hasHead: parsed.branch.oid !== null,
    ...(statusSnapshot.unavailableReason === undefined
      ? {}
      : { unavailableReason: statusSnapshot.unavailableReason }),
    workingTreeNumstat: statusSnapshot.workingTreeNumstat,
  });
  // wave 2：依赖 wave 1 派生值的图查询（gitDir + conflictCount / branch + oid + refs 表）
  const gitDir = splitNonEmptyLines(gitDirOut)[0] ?? "";
  const branchName = parsed.branch.branch;
  const [repoState, mergedIntoDefault] = await Promise.all([
    detectRepoState(gitDir, counts.conflict),
    refsTable === null
      ? Promise.resolve(null)
      : detectMergedIntoDefault(
          execGit,
          cwd,
          branchName,
          parsed.branch.oid,
          defaultBranchCandidates(refsTable),
          parsed.branch.upstream
        ),
  ]);
  const upstreamGone =
    refsTable === null ? false : upstreamGoneFor(refsTable, branchName);
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
    changeSummary,
    files: parsed.files,
    remoteSync: getRemoteSync(cwd),
    repoState,
    stashCount,
  };
}
