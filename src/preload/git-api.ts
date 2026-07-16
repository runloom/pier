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
  GitRemoteOperationResult,
  GitRepoInfo,
  GitStashApplyResult,
  GitStashDropResult,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
  GitStatus,
  GitUndoCommitResult,
} from "@shared/contracts/git.ts";
import type {
  GitReviewCancelRequest,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexRequest,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";
import { gitWatchLeaseSchema } from "@shared/contracts/git-watch.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokePierCommand } from "./ipc-envelope.ts";

// 注意:commit / branch 增删仍保留在 main 命令表,服务 CLI 与未来表面,
// 但不经 preload 暴露。renderer 仅暴露当前 UI 已消费的 checkoutBranch 与
// createAndSwitchBranch 窄口,避免闲置写入口扩大攻击面。

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
  diffMode?: "commitGraph" | "mergeIntoCurrent";
  limit?: number;
  query?: string;
}

export interface GitStashOptionsValue {
  includeUntracked?: boolean;
  message?: string;
}

export interface PierGitAPI {
  abortMerge: (cwd: string) => Promise<GitMergeAbortResult>;
  abortRebase: (cwd: string) => Promise<GitRebaseAbortResult>;
  applyStash: (cwd: string, index?: number) => Promise<GitStashApplyResult>;
  cancelReviewRequest: (request: GitReviewCancelRequest) => Promise<void>;
  checkoutBranch: (cwd: string, name: string) => Promise<boolean>;
  continueRebase: (cwd: string) => Promise<GitRebaseContinueResult>;
  createAndSwitchBranch: (cwd: string, name: string) => Promise<boolean>;
  discardChanges: (cwd: string, paths: string[]) => Promise<boolean>;
  dropStash: (cwd: string, index?: number) => Promise<GitStashDropResult>;
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
  getReviewFileDocument: (
    request: GitReviewFileDocumentRequest
  ) => Promise<GitReviewFileDocumentResult>;
  getReviewIndex: (
    request: GitReviewIndexRequest
  ) => Promise<GitReviewIndexResult>;
  getStatus: (cwd: string) => Promise<GitStatus>;
  isWorkingTreeClean: (cwd: string) => Promise<boolean>;
  listBranches: (
    cwd: string,
    options: GitListBranchesOptionsValue
  ) => Promise<GitBranchRef[]>;
  listIgnored: (cwd: string) => Promise<string[]>;
  listStashes: (cwd: string) => Promise<GitStashListResult>;
  listTags: (cwd: string) => Promise<string[]>;
  merge: (cwd: string, branch: string) => Promise<GitMergeResult>;
  popStash: (cwd: string, index?: number) => Promise<GitStashPopResult>;
  pullFastForward: (cwd: string) => Promise<GitRemoteOperationResult>;
  push: (cwd: string) => Promise<GitRemoteOperationResult>;
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
  sync: (cwd: string) => Promise<GitRemoteOperationResult>;
  undoLastCommit: (cwd: string) => Promise<GitUndoCommitResult>;
  unstage: (cwd: string, paths: string[]) => Promise<boolean>;
  validateBranchName: (cwd: string, name: string) => Promise<boolean>;
  /** 订阅 gitRoot 的 git 变化。返回 unsubscribe。多次 watch 同一 gitRoot 各自独立。 */
  watch: (
    gitRoot: string,
    listener: (event: GitChangeEvent) => void,
    onStartFailure?: (error: Error) => void,
    onReady?: () => void
  ) => () => void;
}

export const gitApi: PierGitAPI = {
  cancelReviewRequest: (request) =>
    invokePierCommand<void>({
      request,
      type: "git.cancelReviewRequest",
    }),
  getStatus: (cwd) =>
    invokePierCommand<GitStatus>({ cwd, type: "git.getStatus" }),
  listIgnored: (cwd) =>
    invokePierCommand<string[]>({ cwd, type: "git.listIgnored" }),
  getRepoInfo: (cwd) =>
    invokePierCommand<GitRepoInfo>({ cwd, type: "git.getRepoInfo" }),
  getReviewIndex: (request) =>
    invokePierCommand<GitReviewIndexResult>({
      request,
      type: "git.getReviewIndex",
    }),
  getReviewFileDocument: (request) =>
    invokePierCommand<GitReviewFileDocumentResult>({
      request,
      type: "git.getReviewFileDocument",
    }),
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
  checkoutBranch: (cwd, name) =>
    invokePierCommand<boolean>({
      cwd,
      name,
      type: "git.checkoutBranch",
    }),
  createAndSwitchBranch: (cwd, name) =>
    invokePierCommand<boolean>({
      cwd,
      name,
      type: "git.createAndSwitchBranch",
    }),
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
  push: (cwd) =>
    invokePierCommand<GitRemoteOperationResult>({
      cwd,
      type: "git.push",
    }),
  pullFastForward: (cwd) =>
    invokePierCommand<GitRemoteOperationResult>({
      cwd,
      type: "git.pullFastForward",
    }),
  sync: (cwd) =>
    invokePierCommand<GitRemoteOperationResult>({
      cwd,
      type: "git.sync",
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
  applyStash: (cwd, index) =>
    invokePierCommand<GitStashApplyResult>({
      ...(index !== undefined && { index }),
      cwd,
      type: "git.stashApply",
    }),
  dropStash: (cwd, index) =>
    invokePierCommand<GitStashDropResult>({
      ...(index !== undefined && { index }),
      cwd,
      type: "git.stashDrop",
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
  watch: (gitRoot, listener, onStartFailure, onReady) => {
    let disposed = false;
    let acceptedGitRoot: string | null = null;
    const filtered = (_event: unknown, payload: GitChangeEvent): void => {
      if (payload.gitRoot === acceptedGitRoot) {
        listener(payload);
      }
    };
    const reportStartFailure = (error: unknown): void => {
      if (disposed) {
        return;
      }
      ipcRenderer.off(PIER_BROADCAST.GIT_CHANGED, filtered);
      try {
        onStartFailure?.(
          error instanceof Error ? error : new Error(String(error))
        );
      } catch {
        // renderer 回调不得改变 START/STOP 引用计数协议
      }
    };
    ipcRenderer.on(PIER_BROADCAST.GIT_CHANGED, filtered);
    // main 侧按 (wc, gitRoot) 引用计数;START 失败(权限/窗口未注册)时不得发 STOP,
    // 否则会错误递减其他消费方共享的计数。then 链保证 STOP 严格晚于 START 送达。
    const started = ipcRenderer.invoke(PIER.GIT_WATCH_START, gitRoot).then(
      (value: unknown) => {
        const lease = gitWatchLeaseSchema.safeParse(value);
        if (!lease.success) {
          reportStartFailure(
            new Error(`Git watch subscription was rejected: ${gitRoot}`)
          );
          return null;
        }
        acceptedGitRoot = lease.data.gitRoot;
        if (!disposed) {
          try {
            onReady?.();
          } catch {
            // renderer 回调不得改变 START/STOP 引用计数协议
          }
        }
        return lease.data;
      },
      (error: unknown) => {
        reportStartFailure(error);
        return null;
      }
    );
    return () => {
      disposed = true;
      ipcRenderer.off(PIER_BROADCAST.GIT_CHANGED, filtered);
      started
        .then((lease) =>
          lease
            ? ipcRenderer.invoke(PIER.GIT_WATCH_STOP, {
                leaseId: lease.leaseId,
              })
            : undefined
        )
        .catch(() => undefined);
    };
  },
};
