import { gitWatchLeaseSchema } from "@shared/contracts/git/watch.ts";
import type {
  GitBranchRef,
  GitChangeEvent,
  GitCheckoutResult,
  GitCommitSearchResult,
  GitDiffBranchesResult,
  GitDiffPatch,
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitRemoteOperationResult,
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
} from "@shared/contracts/git.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { gitReviewApi, type PierGitReviewAPI } from "./git-review-api.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

// 注意:branch 单独增删(git.createBranch/git.deleteBranch)仍保留在 main 命令表,
// 服务 CLI 与未来表面,但不经 preload 暴露。preload 只暴露当前 UI/插件已
// 消费的方法,避免闲置入口扩大攻击面。
// git.openReviewPanel 同理保留:消费方是配对移动端(S2 变更入口与桌面同步
// show-or-focus 审查面板);桌面 renderer 自有直接打开路径,不需经 main 往返。

/** diff 范围/路径选项(IPC 层用值类型;详细 zod 在 contracts/git.ts) */
export interface GitDiffOptionsValue {
  from?: string;
  paths?: string[];
  staged?: boolean;
  to?: string;
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

export interface GitCommitOptionsValue {
  allowEmpty?: boolean;
  message: string;
  signoff?: boolean;
}

export interface GitSearchCommitsOptionsValue {
  limit?: number;
  query?: string;
}

export interface GitStashOptionsValue {
  includeUntracked?: boolean;
  message?: string;
}

export interface PierGitAPI extends PierGitReviewAPI {
  abortCherryPick: (cwd: string) => Promise<GitSequencerAbortResult>;
  abortMerge: (cwd: string) => Promise<GitMergeAbortResult>;
  abortRebase: (cwd: string) => Promise<GitRebaseAbortResult>;
  abortRevert: (cwd: string) => Promise<GitSequencerAbortResult>;
  applyStash: (cwd: string, index?: number) => Promise<GitStashApplyResult>;
  checkoutBranch: (cwd: string, name: string) => Promise<GitCheckoutResult>;
  cherryPick: (cwd: string, oid: string) => Promise<GitSequencerResult>;
  commit: (cwd: string, options: GitCommitOptionsValue) => Promise<boolean>;
  continueCherryPick: (cwd: string) => Promise<GitSequencerContinueResult>;
  continueRebase: (cwd: string) => Promise<GitRebaseContinueResult>;
  continueRevert: (cwd: string) => Promise<GitSequencerContinueResult>;
  createAndSwitchBranch: (cwd: string, name: string) => Promise<boolean>;
  discardChanges: (cwd: string, paths: string[]) => Promise<boolean>;
  dropStash: (cwd: string, index?: number) => Promise<GitStashDropResult>;
  fetch: (cwd: string) => Promise<GitRemoteOperationResult>;
  // 读(git:read)
  getDiffPatch: (
    cwd: string,
    options?: GitDiffOptionsValue
  ) => Promise<GitDiffPatch>;
  getStatus: (cwd: string) => Promise<GitStatus>;
  listBranches: (
    cwd: string,
    options: GitListBranchesOptionsValue
  ) => Promise<GitBranchRef[]>;
  listIgnored: (cwd: string) => Promise<string[]>;
  listStashes: (cwd: string) => Promise<GitStashListResult>;
  merge: (cwd: string, branch: string) => Promise<GitMergeResult>;
  popStash: (cwd: string, index?: number) => Promise<GitStashPopResult>;
  publish: (cwd: string) => Promise<GitRemoteOperationResult>;
  pullFastForward: (cwd: string) => Promise<GitRemoteOperationResult>;
  push: (cwd: string) => Promise<GitRemoteOperationResult>;
  rebase: (cwd: string, branch: string) => Promise<GitRebaseResult>;
  revert: (cwd: string, oid: string) => Promise<GitSequencerResult>;
  searchBranches: (
    cwd: string,
    options?: GitDiffSearchBranchesOptionsValue
  ) => Promise<GitDiffBranchesResult>;
  searchCommits: (
    cwd: string,
    options?: GitSearchCommitsOptionsValue
  ) => Promise<GitCommitSearchResult>;
  stage: (cwd: string, paths: string[]) => Promise<boolean>;
  stash: (
    cwd: string,
    options?: GitStashOptionsValue
  ) => Promise<GitStashResult>;
  sync: (cwd: string) => Promise<GitRemoteOperationResult>;
  undoLastCommit: (cwd: string) => Promise<GitUndoCommitResult>;
  unstage: (cwd: string, paths: string[]) => Promise<boolean>;

  /** 订阅 gitRoot 的 git 变化。返回 unsubscribe。多次 watch 同一 gitRoot 各自独立。 */
  watch: (
    gitRoot: string,
    listener: (event: GitChangeEvent) => void,
    onStartFailure?: (error: Error) => void,
    onReady?: () => void
  ) => () => void;
}

export const gitApi: PierGitAPI = {
  ...gitReviewApi,
  getStatus: (cwd) =>
    invokePierCommand<GitStatus>({ cwd, type: "git.getStatus" }),
  listIgnored: (cwd) =>
    invokePierCommand<string[]>({ cwd, type: "git.listIgnored" }),
  getDiffPatch: (cwd, options) =>
    invokePierCommand<GitDiffPatch>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.getDiffPatch",
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
  searchCommits: (cwd, options) =>
    invokePierCommand<GitCommitSearchResult>({
      cwd,
      ...(options !== undefined && { options }),
      type: "git.searchCommits",
    }),
  stage: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.stage" }),
  unstage: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.unstage" }),

  discardChanges: (cwd, paths) =>
    invokePierCommand<boolean>({ cwd, paths, type: "git.discardChanges" }),
  checkoutBranch: (cwd, name) =>
    invokePierCommand<GitCheckoutResult>({
      cwd,
      name,
      type: "git.checkoutBranch",
    }),
  commit: (cwd, options) =>
    invokePierCommand<boolean>({
      ...(options.allowEmpty !== undefined && {
        allowEmpty: options.allowEmpty,
      }),
      ...(options.signoff !== undefined && { signoff: options.signoff }),
      cwd,
      message: options.message,
      type: "git.commit",
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
  publish: (cwd) =>
    invokePierCommand<GitRemoteOperationResult>({
      cwd,
      type: "git.publish",
    }),
  fetch: (cwd) =>
    invokePierCommand<GitRemoteOperationResult>({
      cwd,
      type: "git.fetch",
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
  cherryPick: (cwd, oid) =>
    invokePierCommand<GitSequencerResult>({
      cwd,
      oid,
      type: "git.cherryPick",
    }),
  abortCherryPick: (cwd) =>
    invokePierCommand<GitSequencerAbortResult>({
      cwd,
      type: "git.cherryPickAbort",
    }),
  continueCherryPick: (cwd) =>
    invokePierCommand<GitSequencerContinueResult>({
      cwd,
      type: "git.cherryPickContinue",
    }),
  revert: (cwd, oid) =>
    invokePierCommand<GitSequencerResult>({
      cwd,
      oid,
      type: "git.revert",
    }),
  abortRevert: (cwd) =>
    invokePierCommand<GitSequencerAbortResult>({
      cwd,
      type: "git.revertAbort",
    }),
  continueRevert: (cwd) =>
    invokePierCommand<GitSequencerContinueResult>({
      cwd,
      type: "git.revertContinue",
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
