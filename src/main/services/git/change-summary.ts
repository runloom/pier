import type {
  GitChangeSummary,
  GitChangeSummaryUnavailableReason,
  GitFileStatus,
} from "../../../shared/contracts/git.ts";
import { GitExecError } from "./exec.ts";
import type { ExecGitFn } from "./status-detectors.ts";
import {
  type GitUntrackedFileInspector,
  type GitUntrackedFileReader,
  readGitUntrackedPathStats,
} from "./untracked-path-stats.ts";

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
} from "./untracked-path-stats.ts";

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

/**
 * `--numstat -z` 记录涉及的路径（rename/copy 记录同时给出旧、新路径）。
 * 记录格式不合法时返回 null，判定与 parseNumstat 一致。
 * watch 用它证明 numstat 没有谈到 status 之外的文件，两者才算同一工作树状态。
 */
export function numstatPaths(output: string): readonly string[] | null {
  const paths: string[] = [];
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length === 0) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) return null;
    const inlinePath = record.slice(secondTab + 1);
    if (inlinePath.length > 0) {
      paths.push(inlinePath);
      continue;
    }
    const origPath = records[index + 1] ?? "";
    const path = records[index + 2] ?? "";
    if (origPath.length === 0 || path.length === 0) return null;
    paths.push(origPath, path);
    index += 2;
  }
  return paths;
}

/**
 * numstat 若列出 status 没有的路径，说明两次取样之间有已跟踪文件被改动，
 * 两者不属于同一工作树状态。rename/copy 的旧路径也算 status 已知
 *（`origPath`，或未配对时的 D 条目）。numstat 格式不合法同样视为不一致。
 */
export function numstatWithinStatus(
  files: readonly GitFileStatus[],
  numstatOut: string
): boolean {
  const paths = numstatPaths(numstatOut);
  if (paths === null) {
    return false;
  }
  if (paths.length === 0) {
    return true;
  }
  const known = new Set<string>();
  for (const file of files) {
    known.add(file.path);
    if (file.origPath !== null) {
      known.add(file.origPath);
    }
  }
  return paths.every((path) => known.has(path));
}

/**
 * 组装状态栏的全范围摘要。
 * 可计文本行必须准确进 +/-；binary / 目录 / 嵌套仓 / 读失败的未跟踪路径进
 * excludedFiles，仍返回 lineDelta。filesOnly 仅用于整段不可用（numstat 失败、
 * status/numstat 不一致等），禁止因单个不可计路径丢掉已算好的 +/-。
 */
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
  return {
    changedFiles,
    deletions: tracked.deletions,
    excludedFiles:
      tracked.excludedFiles + untracked.excludedFiles + untracked.omittedFiles,
    insertions: tracked.insertions + untracked.insertions,
    kind: "lineDelta",
  };
}
