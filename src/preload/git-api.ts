import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  GitBranchRef,
  GitChangeEvent,
  GitCommit,
  GitDiffBranchesResult,
  GitDiffPatch,
  GitDiffSummary,
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitRepoInfo,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
  GitStatus,
  GitUndoCommitResult,
} from "@shared/contracts/git.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/** diff 范围/路径选项(IPC 层用值类型;详细 zod 在 contracts/git.ts) */
export interface GitDiffOptionsValue {
  from?: string;
  paths?: string[];
  staged?: boolean;
  to?: string;
}

export interface GitLogOptionsValue {
  author?: string;
  grep?: string;
  maxCount?: number;
  path?: string;
  since?: string;
  until?: string;
}

export interface GitFileContentOptionsValue {
  path: string;
  ref?: string;
}

export interface GitListBranchesOptionsValue {
  kind: "all" | "local" | "remote";
}

export interface GitDiffSearchBranchesOptionsValue {
  currentBranch?: null | string;
  limit?: number;
  query?: string;
}

export interface GitCommitOptionsValue {
  allowEmpty?: boolean;
  message: string;
  signoff?: boolean;
}

export interface GitCreateBranchOptionsValue {
  name: string;
  startPoint?: string;
}

export interface GitDeleteBranchOptionsValue {
  force?: boolean;
  name: string;
}

export interface GitStashOptionsValue {
  includeUntracked?: boolean;
  message?: string;
}

export interface PierGitAPI {
  abortMerge: (cwd: string) => Promise<GitMergeAbortResult>;
  abortRebase: (cwd: string) => Promise<GitRebaseAbortResult>;
  checkoutBranch: (cwd: string, name: string) => Promise<boolean>;
  commit: (cwd: string, options: GitCommitOptionsValue) => Promise<boolean>;
  continueRebase: (cwd: string) => Promise<GitRebaseContinueResult>;
  createBranch: (
    cwd: string,
    options: GitCreateBranchOptionsValue
  ) => Promise<boolean>;
  deleteBranch: (
    cwd: string,
    options: GitDeleteBranchOptionsValue
  ) => Promise<boolean>;
  discardChanges: (cwd: string, paths: string[]) => Promise<boolean>;
  // 读(git:read)
  getCommit: (cwd: string, oid: string) => Promise<GitCommit>;
  getCommitPatch: (cwd: string, oid: string) => Promise<GitDiffPatch>;
  getDiffPatch: (
    cwd: string,
    options?: GitDiffOptionsValue
  ) => Promise<GitDiffPatch>;
  getDiffSummary: (
    cwd: string,
    options?: GitDiffOptionsValue
  ) => Promise<GitDiffSummary>;
  getDiffText: (cwd: string, options?: GitDiffOptionsValue) => Promise<string>;
  getFileContent: (
    cwd: string,
    options: GitFileContentOptionsValue
  ) => Promise<string>;
  getLog: (cwd: string, options?: GitLogOptionsValue) => Promise<GitCommit[]>;
  getRepoInfo: (cwd: string) => Promise<GitRepoInfo>;
  getStatus: (cwd: string) => Promise<GitStatus>;
  isWorkingTreeClean: (cwd: string) => Promise<boolean>;
  listBranches: (
    cwd: string,
    options: GitListBranchesOptionsValue
  ) => Promise<GitBranchRef[]>;
  listStashes: (cwd: string) => Promise<GitStashListResult>;
  listTags: (cwd: string) => Promise<string[]>;
  merge: (cwd: string, branch: string) => Promise<GitMergeResult>;
  popStash: (cwd: string, index?: number) => Promise<GitStashPopResult>;
  rebase: (cwd: string, branch: string) => Promise<GitRebaseResult>;
  resolveRef: (cwd: string, ref: string) => Promise<string>;
  searchBranches: (
    cwd: string,
    options?: GitDiffSearchBranchesOptionsValue
  ) => Promise<GitDiffBranchesResult>;
  // 写(git:write;默认 desktop-renderer 已给,与 worktree:write 同等待遇;二次确认由插件 UI 负责)
  stage: (cwd: string, paths: string[]) => Promise<boolean>;
  stash: (
    cwd: string,
    options?: GitStashOptionsValue
  ) => Promise<GitStashResult>;
  undoLastCommit: (cwd: string) => Promise<GitUndoCommitResult>;
  unstage: (cwd: string, paths: string[]) => Promise<boolean>;
  validateBranchName: (cwd: string, name: string) => Promise<boolean>;
  /** 订阅 gitRoot 的 git 变化。返回 unsubscribe。多次 watch 同一 gitRoot 各自独立。 */
  watch: (
    gitRoot: string,
    listener: (event: GitChangeEvent) => void
  ) => () => void;
}

async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

export const gitApi: PierGitAPI = {
  getStatus: (cwd) =>
    invokePierCommand<GitStatus>({ cwd, type: "git.getStatus" }),
  getRepoInfo: (cwd) =>
    invokePierCommand<GitRepoInfo>({ cwd, type: "git.getRepoInfo" }),
  isWorkingTreeClean: (cwd) =>
    invokePierCommand<boolean>({ cwd, type: "git.isWorkingTreeClean" }),
  getDiffText: (cwd, options) =>
    invokePierCommand<string>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.getDiffText",
    }),
  getDiffSummary: (cwd, options) =>
    invokePierCommand<GitDiffSummary>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.getDiffSummary",
    }),
  getDiffPatch: (cwd, options) =>
    invokePierCommand<GitDiffPatch>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.getDiffPatch",
    }),
  getLog: (cwd, options) =>
    invokePierCommand<GitCommit[]>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.getLog",
    }),
  getCommit: (cwd, oid) =>
    invokePierCommand<GitCommit>({ cwd, oid, type: "git.getCommit" }),
  getCommitPatch: (cwd, oid) =>
    invokePierCommand<GitDiffPatch>({
      cwd,
      oid,
      type: "git.getCommitPatch",
    }),
  getFileContent: (cwd, options) =>
    invokePierCommand<string>({
      cwd,
      options,
      type: "git.getFileContent",
    }),
  listBranches: (cwd, options) =>
    invokePierCommand<GitBranchRef[]>({
      cwd,
      options,
      type: "git.listBranches",
    }),
  searchBranches: (cwd, options) =>
    invokePierCommand<GitDiffBranchesResult>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.searchBranches",
    }),
  listTags: (cwd) => invokePierCommand<string[]>({ cwd, type: "git.listTags" }),
  resolveRef: (cwd, ref) =>
    invokePierCommand<string>({ cwd, ref, type: "git.resolveRef" }),
  validateBranchName: (cwd, name) =>
    invokePierCommand<boolean>({ cwd, name, type: "git.validateBranchName" }),
  stage: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.stage" }),
  unstage: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.unstage" }),
  discardChanges: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.discardChanges" }),
  commit: (cwd, options) =>
    invokePierCommand<boolean>({
      ...(options.allowEmpty !== undefined && {
        allowEmpty: options.allowEmpty,
      }),
      cwd,
      message: options.message,
      ...(options.signoff !== undefined && { signoff: options.signoff }),
      type: "git.commit",
    }),
  createBranch: (cwd, options) =>
    invokePierCommand<boolean>({
      cwd,
      name: options.name,
      ...(options.startPoint !== undefined && {
        startPoint: options.startPoint,
      }),
      type: "git.createBranch",
    }),
  deleteBranch: (cwd, options) =>
    invokePierCommand<boolean>({
      cwd,
      ...(options.force !== undefined && { force: options.force }),
      name: options.name,
      type: "git.deleteBranch",
    }),
  checkoutBranch: (cwd, name) =>
    invokePierCommand<boolean>({ cwd, name, type: "git.checkoutBranch" }),
  merge: (cwd, branch) =>
    invokePierCommand<GitMergeResult>({
      branch,
      cwd,
      type: "git.merge",
    }),
  abortMerge: (cwd) =>
    invokePierCommand<GitMergeAbortResult>({
      cwd,
      type: "git.mergeAbort",
    }),
  stash: (cwd, options = {}) =>
    invokePierCommand<GitStashResult>({
      ...(options.includeUntracked !== undefined && {
        includeUntracked: options.includeUntracked,
      }),
      ...(options.message !== undefined && { message: options.message }),
      cwd,
      type: "git.stash",
    }),
  popStash: (cwd, index) =>
    invokePierCommand<GitStashPopResult>({
      ...(index !== undefined && { index }),
      cwd,
      type: "git.stashPop",
    }),
  listStashes: (cwd) =>
    invokePierCommand<GitStashListResult>({ cwd, type: "git.stashList" }),
  rebase: (cwd, branch) =>
    invokePierCommand<GitRebaseResult>({
      branch,
      cwd,
      type: "git.rebase",
    }),
  abortRebase: (cwd) =>
    invokePierCommand<GitRebaseAbortResult>({
      cwd,
      type: "git.rebaseAbort",
    }),
  continueRebase: (cwd) =>
    invokePierCommand<GitRebaseContinueResult>({
      cwd,
      type: "git.rebaseContinue",
    }),
  undoLastCommit: (cwd) =>
    invokePierCommand<GitUndoCommitResult>({
      cwd,
      type: "git.undoLastCommit",
    }),
  watch: (gitRoot, listener) => {
    const filtered = (_event: unknown, payload: GitChangeEvent): void => {
      if (payload.gitRoot === gitRoot) {
        listener(payload);
      }
    };
    ipcRenderer.on(PIER_BROADCAST.GIT_CHANGED, filtered);
    ipcRenderer.invoke(PIER.GIT_WATCH_START, gitRoot).catch(() => undefined);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.GIT_CHANGED, filtered);
      ipcRenderer.invoke(PIER.GIT_WATCH_STOP, gitRoot).catch(() => undefined);
    };
  },
};
