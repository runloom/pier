import type { z } from "zod";
import type {
  GitBranchRef,
  GitCommit,
  GitDiffBranchesResult,
  GitDiffPatch,
  GitDiffSummary,
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitRemoteOperationResult,
  GitRepoInfo,
  GitStashApplyResult,
  GitStashDropResult,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
  GitStatus,
  GitUndoCommitResult,
  getFileContentOptionsSchema,
  gitCommitOptionsSchema,
  gitCreateBranchOptionsSchema,
  gitDeleteBranchOptionsSchema,
  gitDiffOptionsSchema,
  gitDiffSearchBranchesOptionsSchema,
  gitLogOptionsSchema,
  gitPathsSchema,
  listBranchesOptionsSchema,
} from "../../shared/contracts/git.ts";
import { listBranches as listGitBranches } from "./git-branch-list.ts";
import { searchBranches as searchGitBranches } from "./git-branch-search.ts";
import { execGit } from "./git-exec.ts";
import { listIgnoredPaths } from "./git-ignored.ts";
import {
  abortMerge,
  abortRebase,
  applyStash,
  continueRebase,
  dropStash,
  listStashes,
  mergeBranch,
  popStash,
  pullFastForward,
  pushBranch,
  rebaseBranch,
  stashChanges,
  syncBranch,
  undoLastCommit,
} from "./git-operations.ts";
import {
  parseGitLog,
  parseGitNumstat,
  parseGitStatus,
  parseUnifiedDiff,
  splitNonEmptyLines,
} from "./git-parsers.ts";
import {
  assembleGitStatus,
  type PrefetchedStatus,
} from "./git-status-assembler.ts";

const GIT_LOG_FORMAT = "%H%x1f%an%x1f%aI%x1f%s%x1e";
const ORIGIN_HEAD_RE = /^refs\/remotes\/origin\/(.+)$/;

/** 从 contracts schema 派生的 IPC 兼容 option 类型,避免 exactOptionalPropertyTypes 冲突。 */
export type GitDiffOptions = z.infer<typeof gitDiffOptionsSchema>;
export type GitLogOptions = z.infer<typeof gitLogOptionsSchema>;
export type ListBranchesOptions = z.infer<typeof listBranchesOptionsSchema>;
export type GitDiffSearchBranchesOptions = z.infer<
  typeof gitDiffSearchBranchesOptionsSchema
>;
export type GetFileContentOptions = z.infer<typeof getFileContentOptionsSchema>;
export type GitPathsRequest = z.infer<typeof gitPathsSchema>;
export type GitCommitOptions = z.infer<typeof gitCommitOptionsSchema>;
export type GitCreateBranchOptions = z.infer<
  typeof gitCreateBranchOptionsSchema
>;
export type GitDeleteBranchOptions = z.infer<
  typeof gitDeleteBranchOptionsSchema
>;

/** 写操作统一 60s 超时(避免大仓库继承 git-exec 默认 10s 失败)。 */
const WRITE_TIMEOUT_MS = 60_000;

/**
 * branch name 不允许以 "-" 开头,否则 git 会把它当 flag(`git branch --help` 等)。
 * spawn argv 模式虽不构成 shell 注入,但语义会被破坏:任何拿到 git:write 的插件
 * 传 `name: "--force"` 都会触发非预期分支。
 */
function assertSafeBranchName(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(
      `branch name must not start with "-" (would be interpreted as git flag): ${name}`
    );
  }
}

export interface GitService {
  abortMerge(cwd: string): Promise<GitMergeAbortResult>;
  abortRebase(cwd: string): Promise<GitRebaseAbortResult>;
  applyStash(cwd: string, index?: number): Promise<GitStashApplyResult>;
  checkoutBranch(cwd: string, name: string): Promise<void>;
  commit(cwd: string, options: GitCommitOptions): Promise<void>;
  continueRebase(cwd: string): Promise<GitRebaseContinueResult>;
  createBranch(cwd: string, options: GitCreateBranchOptions): Promise<void>;
  deleteBranch(cwd: string, options: GitDeleteBranchOptions): Promise<void>;
  discardChanges(cwd: string, request: GitPathsRequest): Promise<void>;
  dropStash(cwd: string, index?: number): Promise<GitStashDropResult>;
  // —— 读 ——
  getCommit(cwd: string, oid: string): Promise<GitCommit>;
  getCommitPatch(cwd: string, oid: string): Promise<GitDiffPatch>;
  getDiffPatch(cwd: string, options?: GitDiffOptions): Promise<GitDiffPatch>;
  getDiffSummary(
    cwd: string,
    options?: GitDiffOptions
  ): Promise<GitDiffSummary>;
  getDiffText(cwd: string, options?: GitDiffOptions): Promise<string>;
  getFileContent(cwd: string, options: GetFileContentOptions): Promise<string>;
  getLog(cwd: string, options?: GitLogOptions): Promise<GitCommit[]>;
  getRepoInfo(cwd: string): Promise<GitRepoInfo>;
  getStatus(cwd: string, prefetched?: PrefetchedStatus): Promise<GitStatus>;
  isWorkingTreeClean(cwd: string): Promise<boolean>;
  listBranches(
    cwd: string,
    options: ListBranchesOptions
  ): Promise<GitBranchRef[]>;
  /** gitignore 命中的路径(相对 gitRoot;目录折叠为 `dir/` 单条)。树的 ignored 变暗用。 */
  listIgnored(cwd: string): Promise<string[]>;
  listStashes(cwd: string): Promise<GitStashListResult>;
  listTags(cwd: string): Promise<string[]>;
  merge(cwd: string, branch: string): Promise<GitMergeResult>;
  popStash(cwd: string, index?: number): Promise<GitStashPopResult>;
  pullFastForward(cwd: string): Promise<GitRemoteOperationResult>;
  push(cwd: string): Promise<GitRemoteOperationResult>;
  rebase(cwd: string, branch: string): Promise<GitRebaseResult>;
  resolveRef(cwd: string, ref: string): Promise<string>;
  searchBranches(
    cwd: string,
    options?: GitDiffSearchBranchesOptions
  ): Promise<GitDiffBranchesResult>;
  // —— 写(需 git:write capability) ——
  stage(cwd: string, request: GitPathsRequest): Promise<void>;
  stash(
    cwd: string,
    options: { includeUntracked?: boolean; message?: string }
  ): Promise<GitStashResult>;
  sync(cwd: string): Promise<GitRemoteOperationResult>;
  undoLastCommit(cwd: string): Promise<GitUndoCommitResult>;
  unstage(cwd: string, request: GitPathsRequest): Promise<void>;
  validateBranchName(cwd: string, name: string): Promise<boolean>;
}

interface GitServiceExecOptions {
  env?: Readonly<Record<string, string>>;
  onSuccessStderr?: (stderr: string) => void;
  timeoutMs?: number;
}

type GitServiceExec = (
  args: readonly string[],
  cwd: string,
  options?: GitServiceExecOptions
) => Promise<string>;

export interface CreateGitServiceOptions {
  execGit?: GitServiceExec;
  resolveEnvironment?: (
    cwd: string
  ) => Promise<Readonly<Record<string, string>>>;
}

function diffRangeArgs(options: GitDiffOptions): string[] {
  const args: string[] = [];
  if (options.staged) {
    args.push("--cached");
  }
  if (options.from && options.to) {
    args.push(
      `${safeGitRevision(options.from, "diff from")}..${safeGitRevision(
        options.to,
        "diff to"
      )}`
    );
  } else if (options.from) {
    args.push(safeGitRevision(options.from, "diff from"));
  }
  if (options.paths && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }
  return args;
}

function safeGitRevision(value: string, label: string): string {
  if (value.startsWith("-")) {
    throw new Error(`${label} must not start with "-"`);
  }
  return value;
}

function logArgs(options: GitLogOptions): string[] {
  const maxCount = options.maxCount ?? 50;
  const args: string[] = [
    "log",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${maxCount}`,
  ];
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.grep) {
    args.push(`--grep=${options.grep}`);
  }
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.path) {
    args.push("--", options.path);
  }
  return args;
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: GitServiceExecOptions
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

function withResolvedEnvironment(
  exec: GitServiceExec,
  resolveEnvironment:
    | ((cwd: string) => Promise<Readonly<Record<string, string>>>)
    | undefined
): GitServiceExec {
  if (!resolveEnvironment) {
    return exec;
  }
  return async (args, cwd, options) => {
    let env: Readonly<Record<string, string>>;
    try {
      env = await resolveEnvironment(cwd);
    } catch {
      env = {};
    }
    return exec(args, cwd, {
      ...options,
      env: { ...env, ...(options?.env ?? {}) },
    });
  };
}

async function readHeadOid(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    return (await exec(["rev-parse", "--verify", "HEAD"], cwd)).trim();
  } catch {
    return null;
  }
}

async function readDefaultBranch(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    const out = (
      await exec(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd)
    ).trim();
    return ORIGIN_HEAD_RE.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * 核心 Git 服务(main 进程)。默认 spawn 原生 git(execGit 可注入便于测试)。
 * 读写授权在命令入口按 git:read/git:write 控制; 本层负责参数化执行和解析。
 */
export function createGitService({
  execGit = defaultExecGit,
  resolveEnvironment,
}: CreateGitServiceOptions = {}): GitService {
  const runGit = withResolvedEnvironment(execGit, resolveEnvironment);
  return {
    abortMerge: (cwd) => abortMerge(runGit, cwd),
    abortRebase: (cwd) => abortRebase(runGit, cwd),
    continueRebase: (cwd) => continueRebase(runGit, cwd),
    getCommit: async (cwd, oid) => {
      const output = await runGit(
        [
          "log",
          "-1",
          `--format=${GIT_LOG_FORMAT}`,
          safeGitRevision(oid, "commit oid"),
        ],
        cwd
      );
      const head = parseGitLog(output)[0];
      if (head === undefined) {
        throw new Error(`commit not found: ${oid}`);
      }
      return head;
    },
    getCommitPatch: async (cwd, oid) => {
      const text = await runGit(
        [
          "show",
          "--format=",
          "--no-color",
          "--no-ext-diff",
          safeGitRevision(oid, "commit oid"),
        ],
        cwd
      );
      return parseUnifiedDiff(text);
    },
    getDiffSummary: async (cwd, options = {}) => {
      const output = await runGit(
        ["diff", "--numstat", "-z", "--no-renames", ...diffRangeArgs(options)],
        cwd
      );
      const files = parseGitNumstat(output);
      return {
        changed: files.length,
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        files,
        insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      };
    },
    getDiffPatch: async (cwd, options = {}) => {
      const text = await runGit(
        ["diff", "--no-color", "--no-ext-diff", ...diffRangeArgs(options)],
        cwd
      );
      return parseUnifiedDiff(text);
    },
    getDiffText: (cwd, options = {}) =>
      runGit(
        ["diff", "--no-color", "--no-ext-diff", ...diffRangeArgs(options)],
        cwd
      ),
    getFileContent: (cwd, options) =>
      runGit(
        [
          "show",
          `${safeGitRevision(options.ref ?? "HEAD", "file ref")}:${
            options.path
          }`,
        ],
        cwd
      ),
    getLog: async (cwd, options = {}) => {
      const output = await runGit(logArgs(options), cwd);
      return parseGitLog(output);
    },
    getRepoInfo: async (cwd) => {
      // --path-format=absolute 让 --git-common-dir 也返回绝对路径
      // (默认它返回相对路径 ".git",会让 isWorktree 在普通仓库假阳性为 true)
      const pathOutput = await runGit(
        [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--absolute-git-dir",
          "--git-common-dir",
        ],
        cwd
      );
      const lines = splitNonEmptyLines(pathOutput);
      const gitRoot = lines[0] ?? "";
      const gitDir = lines[1] ?? "";
      const gitCommonDir = lines[2] ?? "";
      const bareOutput = (
        await runGit(["rev-parse", "--is-bare-repository"], cwd)
      ).trim();
      const [headOid, defaultBranch] = await Promise.all([
        readHeadOid(cwd, runGit),
        readDefaultBranch(cwd, runGit),
      ]);
      return {
        defaultBranch,
        gitCommonDir,
        gitDir,
        gitRoot,
        headOid,
        isBare: bareOutput === "true",
        isWorktree: gitDir !== gitCommonDir,
      };
    },
    getStatus: (cwd, prefetched) => assembleGitStatus(runGit, cwd, prefetched),
    isWorkingTreeClean: async (cwd) => {
      const output = await runGit(
        ["status", "--porcelain=v2", "--branch", "-z"],
        cwd
      );
      return parseGitStatus(output).files.length === 0;
    },
    listBranches: (cwd, options) => listGitBranches(runGit, cwd, options),
    searchBranches: (cwd, options = {}) =>
      searchGitBranches(runGit, cwd, options),
    listIgnored: (cwd) => listIgnoredPaths(runGit, cwd),
    listStashes: (cwd) => listStashes(runGit, cwd),
    listTags: async (cwd) => {
      const output = await runGit(
        ["for-each-ref", "--format=%(refname:short)", "refs/tags"],
        cwd
      );
      return splitNonEmptyLines(output);
    },
    resolveRef: async (cwd, ref) => {
      const output = await runGit(
        ["rev-parse", "--verify", safeGitRevision(ref, "ref")],
        cwd
      );
      return output.trim();
    },
    validateBranchName: async (cwd, name) => {
      try {
        await runGit(["check-ref-format", "--branch", name], cwd);
        return true;
      } catch {
        return false;
      }
    },
    // —— 写操作:全部传 timeoutMs 60s ——
    stage: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("stage requires at least one path");
      }
      await runGit(["add", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    unstage: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("unstage requires at least one path");
      }
      await runGit(["restore", "--staged", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    discardChanges: async (cwd, request) => {
      if (request.paths.length === 0) {
        throw new Error("discardChanges requires at least one path");
      }
      await runGit(["restore", "--", ...request.paths], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    commit: async (cwd, options) => {
      const args = ["commit", "-m", options.message];
      if (options.signoff) {
        args.push("--signoff");
      }
      if (options.allowEmpty) {
        args.push("--allow-empty");
      }
      await runGit(args, cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
    createBranch: async (cwd, options) => {
      assertSafeBranchName(options.name);
      const args = ["branch", options.name];
      if (options.startPoint) {
        args.push(options.startPoint);
      }
      await runGit(args, cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
    deleteBranch: async (cwd, options) => {
      assertSafeBranchName(options.name);
      await runGit(["branch", options.force ? "-D" : "-d", options.name], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    checkoutBranch: async (cwd, name) => {
      assertSafeBranchName(name);
      await runGit(["switch", name], cwd, { timeoutMs: WRITE_TIMEOUT_MS });
    },
    merge: (cwd, branch) => mergeBranch(runGit, cwd, branch),
    applyStash: (cwd, index) => applyStash(runGit, cwd, index),
    dropStash: (cwd, index) => dropStash(runGit, cwd, index),
    popStash: (cwd, index) => popStash(runGit, cwd, index),
    pullFastForward: (cwd) => pullFastForward(runGit, cwd),
    push: (cwd) => pushBranch(runGit, cwd),
    rebase: (cwd, branch) => rebaseBranch(runGit, cwd, branch),
    stash: (cwd, options) => stashChanges(runGit, cwd, options),
    sync: (cwd) => syncBranch(runGit, cwd),
    undoLastCommit: (cwd) => undoLastCommit(runGit, cwd),
  };
}
