import type { z } from "zod";
import type {
  GitFileBaselineInput,
  GitFileBaselineResult,
} from "../../../shared/contracts/git/file-baseline.ts";
import type {
  GitApplyPatchResult,
  GitBranchRef,
  GitCheckoutResult,
  GitCommit,
  GitCommitSearchResult,
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
  GitSequencerAbortResult,
  GitSequencerContinueResult,
  GitSequencerResult,
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
  gitDiffSearchBranchesOptionsSchema,
  gitPathsSchema,
  gitSearchCommitsOptionsSchema,
  listBranchesOptionsSchema,
} from "../../../shared/contracts/git.ts";
import {
  type GitApplyPatchRequest,
  applyPatch as runApplyPatch,
} from "./apply-patch.ts";
import { listBranches as listGitBranches } from "./branch-list.ts";
import { searchBranches as searchGitBranches } from "./branch-search.ts";
import { assertSafeBranchName, switchBranch } from "./branch-switch.ts";
import { GIT_STATUS_ARGS } from "./change-summary.ts";
import { searchCommits as searchGitCommits } from "./commit-search.ts";
import {
  discardChanges as discardWorkingTreeChanges,
  type TrashItem,
  trashViaElectronShell,
} from "./discard-operations.ts";
import type { ExecGitRaw } from "./exec.ts";
import { createGitFileBaselineReader } from "./file-baseline/index.ts";
import { listIgnoredPaths } from "./ignored.ts";
import { WRITE_TIMEOUT_MS } from "./operation-helpers.ts";
import {
  abortCherryPick,
  abortMerge,
  abortRebase,
  abortRevert,
  cherryPickCommit,
  continueCherryPick,
  continueRebase,
  continueRevert,
  fetchRemotes,
  mergeBranch,
  publishBranch,
  pullFastForward,
  pushBranch,
  rebaseBranch,
  revertCommit,
  syncBranch,
  undoLastCommit,
} from "./operations.ts";
import {
  parseGitLog,
  parseGitNumstat,
  parseGitStatus,
  parseUnifiedDiff,
  splitNonEmptyLines,
} from "./parsers.ts";
import { recordUserFetchPhase } from "./remote-sync-record.ts";
import {
  defaultExecGit,
  diffRangeArgs,
  GIT_LOG_FORMAT,
  type GitDiffOptions,
  type GitLogOptions,
  type GitServiceExec,
  logArgs,
  readDefaultBranch,
  readHeadOid,
  safeGitRevision,
  withResolvedEnvironment,
} from "./service-support.ts";
import { stagePaths, unstagePaths } from "./stage-operations.ts";
import {
  applyStash,
  dropStash,
  listStashes,
  popStash,
  stashChanges,
} from "./stash-operations.ts";
import {
  assembleGitStatus,
  type PrefetchedStatus,
} from "./status-assembler.ts";

export type { GitDiffOptions, GitLogOptions } from "./service-support.ts";

/** 从 contracts schema 派生的 IPC 兼容 option 类型,避免 exactOptionalPropertyTypes 冲突。 */
export type ListBranchesOptions = z.infer<typeof listBranchesOptionsSchema>;
export type GitDiffSearchBranchesOptions = z.infer<
  typeof gitDiffSearchBranchesOptionsSchema
>;
export type GitSearchCommitsOptions = z.infer<
  typeof gitSearchCommitsOptionsSchema
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

export interface GitService {
  abortCherryPick(cwd: string): Promise<GitSequencerAbortResult>;
  abortMerge(cwd: string): Promise<GitMergeAbortResult>;
  abortRebase(cwd: string): Promise<GitRebaseAbortResult>;
  abortRevert(cwd: string): Promise<GitSequencerAbortResult>;
  // —— 写(需 git:write capability) ——
  applyPatch(
    cwd: string,
    request: GitApplyPatchRequest
  ): Promise<GitApplyPatchResult>;
  applyStash(cwd: string, index?: number): Promise<GitStashApplyResult>;
  checkoutBranch(cwd: string, name: string): Promise<GitCheckoutResult>;
  cherryPick(cwd: string, oid: string): Promise<GitSequencerResult>;
  commit(cwd: string, options: GitCommitOptions): Promise<void>;
  continueCherryPick(cwd: string): Promise<GitSequencerContinueResult>;
  continueRebase(cwd: string): Promise<GitRebaseContinueResult>;
  continueRevert(cwd: string): Promise<GitSequencerContinueResult>;
  createAndSwitchBranch(cwd: string, name: string): Promise<void>;
  createBranch(cwd: string, options: GitCreateBranchOptions): Promise<void>;
  deleteBranch(cwd: string, options: GitDeleteBranchOptions): Promise<void>;
  discardChanges(cwd: string, request: GitPathsRequest): Promise<void>;
  dropStash(cwd: string, index?: number): Promise<GitStashDropResult>;
  fetch(cwd: string): Promise<GitRemoteOperationResult>;
  // —— 读 ——
  getCommit(cwd: string, oid: string): Promise<GitCommit>;
  getCommitPatch(cwd: string, oid: string): Promise<GitDiffPatch>;
  getDiffPatch(cwd: string, options?: GitDiffOptions): Promise<GitDiffPatch>;
  getDiffSummary(
    cwd: string,
    options?: GitDiffOptions
  ): Promise<GitDiffSummary>;
  getDiffText(cwd: string, options?: GitDiffOptions): Promise<string>;
  getFileBaseline(input: GitFileBaselineInput): Promise<GitFileBaselineResult>;
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
  publish(cwd: string): Promise<GitRemoteOperationResult>;
  pullFastForward(cwd: string): Promise<GitRemoteOperationResult>;
  push(cwd: string): Promise<GitRemoteOperationResult>;
  rebase(cwd: string, branch: string): Promise<GitRebaseResult>;
  resolveRef(cwd: string, ref: string): Promise<string>;
  revert(cwd: string, oid: string): Promise<GitSequencerResult>;
  searchBranches(
    cwd: string,
    options?: GitDiffSearchBranchesOptions
  ): Promise<GitDiffBranchesResult>;
  /** 结构化 commit 搜索(供 commit picker;语法见 contracts/git.ts)。 */
  searchCommits(
    cwd: string,
    options?: GitSearchCommitsOptions
  ): Promise<GitCommitSearchResult>;
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

export interface CreateGitServiceOptions {
  execGit?: GitServiceExec;
  execGitRaw?: ExecGitRaw;
  resolveEnvironment?: (
    cwd: string
  ) => Promise<Readonly<Record<string, string>>>;
  /**
   * Untracked discard: move to OS Trash/Recycle Bin (VS Code default).
   * Injected in tests; production uses Electron `shell.trashItem`.
   */
  trashItem?: TrashItem;
}

/**
 * 核心 Git 服务(main 进程)。默认 spawn 原生 git(execGit 可注入便于测试)。
 * 读写授权在命令入口按 git:read/git:write 控制; 本层负责参数化执行和解析。
 */
export function createGitService({
  execGit = defaultExecGit,
  execGitRaw,
  resolveEnvironment,
  trashItem = trashViaElectronShell,
}: CreateGitServiceOptions = {}): GitService {
  const runGit = withResolvedEnvironment(execGit, resolveEnvironment);
  return {
    getFileBaseline: createGitFileBaselineReader({
      ...(execGitRaw === undefined ? {} : { execGitRaw }),
      ...(resolveEnvironment === undefined ? {} : { resolveEnvironment }),
    }),
    abortCherryPick: (cwd) => abortCherryPick(runGit, cwd),
    abortMerge: (cwd) => abortMerge(runGit, cwd),
    abortRebase: (cwd) => abortRebase(runGit, cwd),
    abortRevert: (cwd) => abortRevert(runGit, cwd),
    cherryPick: (cwd, oid) => cherryPickCommit(runGit, cwd, oid),
    continueCherryPick: (cwd) => continueCherryPick(runGit, cwd),
    continueRebase: (cwd) => continueRebase(runGit, cwd),
    continueRevert: (cwd) => continueRevert(runGit, cwd),
    revert: (cwd, oid) => revertCommit(runGit, cwd, oid),
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
      const output = await runGit(GIT_STATUS_ARGS, cwd);
      return parseGitStatus(output).files.length === 0;
    },
    listBranches: (cwd, options) => listGitBranches(runGit, cwd, options),
    searchBranches: (cwd, options = {}) =>
      searchGitBranches(runGit, cwd, options),
    searchCommits: (cwd, options = {}) =>
      searchGitCommits(runGit, cwd, options),
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
    // —— 写操作: 本地写 (stage/commit/…) 用 WRITE_TIMEOUT_MS 60s；
    // push/pull/sync 在 operations.ts 用 REMOTE_WRITE_TIMEOUT_MS（20min，容纳 pre-push）——
    applyPatch: (cwd, request) => runApplyPatch(runGit, cwd, request),
    stage: (cwd, request) => stagePaths(runGit, cwd, request.paths),
    unstage: (cwd, request) => unstagePaths(runGit, cwd, request.paths),
    discardChanges: (cwd, request) =>
      discardWorkingTreeChanges(runGit, cwd, request.paths, trashItem),
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
    createAndSwitchBranch: async (cwd, name) => {
      await switchBranch(runGit, cwd, name, {
        create: true,
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    deleteBranch: async (cwd, options) => {
      assertSafeBranchName(options.name);
      await runGit(["branch", options.force ? "-D" : "-d", options.name], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },
    checkoutBranch: (cwd, name) =>
      switchBranch(runGit, cwd, name, {
        create: false,
        timeoutMs: WRITE_TIMEOUT_MS,
      }),
    merge: (cwd, branch) => mergeBranch(runGit, cwd, branch),
    applyStash: (cwd, index) => applyStash(runGit, cwd, index),
    dropStash: (cwd, index) => dropStash(runGit, cwd, index),
    popStash: (cwd, index) => popStash(runGit, cwd, index),
    fetch: async (cwd) => {
      await recordUserFetchPhase(runGit, cwd, { kind: "fetching" });
      const result = await fetchRemotes(runGit, cwd);
      if (result.kind === "ok") {
        await recordUserFetchPhase(runGit, cwd, { kind: "ok" });
      } else {
        await recordUserFetchPhase(runGit, cwd, {
          kind: "failed",
          message: result.message ?? "",
        });
      }
      return result;
    },
    publish: (cwd) => publishBranch(runGit, cwd),
    pullFastForward: (cwd) => pullFastForward(runGit, cwd),
    push: (cwd) => pushBranch(runGit, cwd),
    rebase: (cwd, branch) => rebaseBranch(runGit, cwd, branch),
    stash: (cwd, options) => stashChanges(runGit, cwd, options),
    sync: (cwd) => syncBranch(runGit, cwd),
    undoLastCommit: (cwd) => undoLastCommit(runGit, cwd),
  };
}
