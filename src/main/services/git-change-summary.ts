import type {
  GitChangeSummary,
  GitChangeSummaryUnavailableReason,
  GitFileStatus,
} from "../../shared/contracts/git.ts";
import { GitExecError } from "./git-exec.ts";
import type { ExecGitFn } from "./git-status-detectors.ts";
import {
  type GitUntrackedFileInspector,
  type GitUntrackedFileReader,
  readGitUntrackedPathStats,
} from "./git-untracked-path-stats.ts";

export {
  closeGitChangeSummaryFileHandle,
  GIT_CHANGE_SUMMARY_FILE_BYTES,
  GIT_CHANGE_SUMMARY_READ_CONCURRENCY,
  GIT_CHANGE_SUMMARY_READ_TIMEOUT_MS,
  GIT_CHANGE_SUMMARY_TOTAL_BYTES,
  type GitUntrackedPathStats,
  gitChangeSummaryStatToken,
  type ReadGitUntrackedPathStatsOptions,
  readGitUntrackedPathStats,
} from "./git-untracked-path-stats.ts";

/** 该数组是状态摘要与 watch 预取共用的唯一 numstat 参数来源。 */
export const GIT_WORKING_TREE_NUMSTAT_ARGS = [
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=none",
  "--find-renames=50%",
  "--find-copies=50%",
  "-l0",
  "--numstat",
  "-z",
] as const;

export const GIT_STATUS_ARGS = [
  "-c",
  "status.renames=copies",
  "-c",
  "status.renameLimit=0",
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--ignore-submodules=none",
  "--untracked-files=all",
] as const;

export interface BuildGitChangeSummaryOptions {
  readonly cwd: string;
  readonly execGit: ExecGitFn;
  readonly files: readonly GitFileStatus[];
  /** 空仓库没有 HEAD 时，按 status 中当前存在的文件相对空树处理。 */
  readonly hasHead?: boolean;
  /** 测试 seam；在调用 readUntrackedFile 前提供 fstat 等价的已确认大小。 */
  readonly inspectUntrackedFile?: GitUntrackedFileInspector;
  /** 测试 seam；生产读取仍在打开正文前完成硬预算预留。 */
  readonly readUntrackedFile?: GitUntrackedFileReader;
  /** 上游一致性取样无法证明 status/numstat 属于同一工作树状态。 */
  readonly unavailableReason?: GitChangeSummaryUnavailableReason;
  /** watch 已在同一轮取得时复用，避免重复 spawn。 */
  readonly workingTreeNumstat?: string;
}

function filesOnly(
  changedFiles: number,
  omittedFiles: number,
  reasons: readonly GitChangeSummaryUnavailableReason[]
): GitChangeSummary {
  return {
    changedFiles,
    kind: "filesOnly",
    omittedFiles,
    reasons: [...new Set(reasons)],
  };
}

export function gitChangeSummaryCommandFailureReason(
  error: unknown
): "commandFailed" | "timeout" {
  return error instanceof GitExecError && error.causeKind === "timeout"
    ? "timeout"
    : "commandFailed";
}

function parseNumstat(output: string): {
  readonly deletions: number;
  readonly excludedFiles: number;
  readonly insertions: number;
} | null {
  let deletions = 0;
  let excludedFiles = 0;
  let insertions = 0;
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length === 0) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) return null;
    const additions = record.slice(0, firstTab);
    const removals = record.slice(firstTab + 1, secondTab);
    if (record.slice(secondTab + 1).length === 0) {
      if (
        (records[index + 1] ?? "").length === 0 ||
        (records[index + 2] ?? "").length === 0
      )
        return null;
      index += 2;
    }
    if (additions === "-" && removals === "-") {
      excludedFiles += 1;
      continue;
    }
    if (!(/^\d+$/u.test(additions) && /^\d+$/u.test(removals))) return null;
    insertions += Number(additions);
    deletions += Number(removals);
  }
  return { deletions, excludedFiles, insertions };
}

/** 组装状态栏的全范围摘要；任何未跟踪路径无法完整计数时退化为 filesOnly。 */
export async function buildGitChangeSummary({
  cwd,
  execGit,
  files,
  hasHead = true,
  inspectUntrackedFile,
  readUntrackedFile,
  unavailableReason,
  workingTreeNumstat,
}: BuildGitChangeSummaryOptions): Promise<GitChangeSummary> {
  const uniqueFiles = [
    ...new Map(files.map((file) => [file.path, file])).values(),
  ];
  const rangeFiles = hasHead
    ? uniqueFiles
    : uniqueFiles.filter((file) => file.worktree !== "D");
  const changedFiles = rangeFiles.length;
  if (unavailableReason !== undefined)
    return filesOnly(changedFiles, changedFiles, [unavailableReason]);
  let tracked = { deletions: 0, excludedFiles: 0, insertions: 0 };
  if (hasHead) {
    try {
      const output =
        workingTreeNumstat ??
        (await execGit([...GIT_WORKING_TREE_NUMSTAT_ARGS, "HEAD"], cwd));
      const parsed = parseNumstat(output);
      if (parsed === null)
        return filesOnly(changedFiles, changedFiles, ["commandFailed"]);
      tracked = parsed;
    } catch (error) {
      return filesOnly(changedFiles, changedFiles, [
        gitChangeSummaryCommandFailureReason(error),
      ]);
    }
  }
  const paths = rangeFiles
    .filter((file) => !hasHead || (file.index === "?" && file.worktree === "?"))
    .map((file) => file.path);
  const untracked = await readGitUntrackedPathStats({
    cwd,
    paths,
    ...(inspectUntrackedFile === undefined ? {} : { inspectUntrackedFile }),
    ...(readUntrackedFile === undefined ? {} : { readUntrackedFile }),
  });
  if (untracked.reasons.length > 0)
    return filesOnly(changedFiles, untracked.omittedFiles, untracked.reasons);
  return {
    changedFiles,
    deletions: tracked.deletions,
    excludedFiles: tracked.excludedFiles + untracked.excludedFiles,
    insertions: tracked.insertions + untracked.insertions,
    kind: "lineDelta",
  };
}
