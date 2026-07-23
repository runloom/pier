import type {
  EnvironmentSnapshotRequest,
  EnvironmentUpdateRequest,
  EnvironmentWorktreeBindingRequest,
  LocalEnvironmentProject,
  LocalEnvironmentState,
  LocalEnvironmentWorktreeBindingSnapshot,
} from "@shared/contracts/environment.ts";
import type {
  FileConfirmDurabilityRequest,
  FileConfirmDurabilityResult,
  FileCopyRequest,
  FileCopyResult,
  FileDocumentReadResult,
  FileDocumentWriteResult,
  FileDraftClaimResult,
  FileDraftDiagnostic,
  FileDraftSnapshot,
  FileDraftWriteResult,
  FileExistsRequest,
  FileExistsResult,
  FileInspectPathImpactRequest,
  FileInspectWriteTargetRequest,
  FileListRequest,
  FileListResult,
  FileMkdirRequest,
  FileMkdirResult,
  FileMoveRequest,
  FileMoveResult,
  FileOpenPathRequest,
  FileOpenPathResult,
  FilePathImpact,
  FileReadDocumentRequest,
  FileReadTextRequest,
  FileRevealRequest,
  FileRevealResult,
  FileStatRequest,
  FileStatResult,
  FileTrashRequest,
  FileTrashResult,
  FileWriteDocumentRequest,
  FileWriteTargetInspection,
  FileWriteTextRequest,
  FileWriteTextResult,
} from "@shared/contracts/file.ts";
import type {
  FilePathQueryStartInput,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import type {
  FileSaveTargetRequest,
  FileSaveTargetResult,
} from "@shared/contracts/file-save-target.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import type {
  GitBranchRef,
  GitChangeEvent,
  GitCommit,
  GitCommitSearchResult,
  GitDiffBranchesResult,
  GitDiffPatch,
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
} from "@shared/contracts/git.ts";
import type {
  GitReviewCancelRequest,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexRequest,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateProgress,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeCreationDefaultsRequest,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreeOpenResult,
  WorktreeOpenTerminalRequest,
  WorktreeOpenTerminalResult,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";

export interface RendererPluginFilesFacade {
  confirmDurability(
    request: FileConfirmDurabilityRequest
  ): Promise<FileConfirmDurabilityResult>;
  copy(request: FileCopyRequest): Promise<FileCopyResult>;
  drafts: {
    claimLegacy(key: string): Promise<FileDraftClaimResult>;
    delete(key: string): Promise<boolean>;
    get(key: string): Promise<FileDraftSnapshot | null>;
    listKeys(): Promise<readonly string[]>;
    listDiagnostics(): Promise<readonly FileDraftDiagnostic[]>;
    set(
      key: string,
      generation: number,
      value: string
    ): Promise<FileDraftWriteResult>;
  };
  exists(request: FileExistsRequest): Promise<FileExistsResult>;
  inspectPathImpact(
    request: FileInspectPathImpactRequest
  ): Promise<FilePathImpact>;
  inspectWriteTarget(
    request: FileInspectWriteTargetRequest
  ): Promise<FileWriteTargetInspection>;
  list(
    requestOrRoot: FileListRequest | string,
    options?: { path?: string }
  ): Promise<FileListResult>;
  mkdir(request: FileMkdirRequest): Promise<FileMkdirResult>;
  move(request: FileMoveRequest): Promise<FileMoveResult>;
  /** Subscribe to path query events (started/batch/done/error) for this document. */
  onPathQueryEvent(listener: (event: FileQueryEvent) => void): () => void;
  /**
   * 在 files 面板内打开磁盘文件（宿主跨插件入口）。
   * files 插件未启用/未注册时返回 false，不抛。
   */
  openInEditor(request: {
    context?: PanelContext;
    path: string;
    root: string;
    title?: string;
  }): boolean;
  openPath(request: FileOpenPathRequest): Promise<FileOpenPathResult>;
  pickSaveTarget(request: FileSaveTargetRequest): Promise<FileSaveTargetResult>;
  /**
   * Start a cancellable path query against the main-process file query service.
   * `queryId` is generated if omitted so the returned handle is available
   * synchronously (design §4.1). `started` resolves to the IPC start result
   * (`false` when main rejects the start); callers that care about hang-free
   * loading must await it after subscribing to events.
   */
  queryPaths(
    request: Omit<FilePathQueryStartInput, "queryId"> & { queryId?: string }
  ): { cancel(): void; queryId: string; started: Promise<boolean> };
  readDocument(
    request: FileReadDocumentRequest
  ): Promise<FileDocumentReadResult>;
  /** @deprecated 新代码使用 readDocument。 */
  readText(request: FileReadTextRequest): Promise<string>;
  reveal(request: FileRevealRequest): Promise<FileRevealResult>;
  stat(request: FileStatRequest): Promise<FileStatResult>;
  trash(request: FileTrashRequest): Promise<FileTrashResult>;
  watch(
    root: string,
    listener: (event: FileWatchEvent) => void,
    options?: { excludes?: readonly string[] }
  ): () => void;
  writeDocument(
    request: FileWriteDocumentRequest
  ): Promise<FileDocumentWriteResult>;
  /** @deprecated 新代码使用 writeDocument。 */
  writeText(request: FileWriteTextRequest): Promise<FileWriteTextResult>;
}

export interface RendererPluginEnvironmentsFacade {
  projectSnapshot(
    projectRootPath: string
  ): Promise<LocalEnvironmentProject | null>;
  snapshot(
    request?: EnvironmentSnapshotRequest
  ): Promise<LocalEnvironmentState>;
  update(request: EnvironmentUpdateRequest): Promise<LocalEnvironmentState>;
  worktreeBinding(
    request: EnvironmentWorktreeBindingRequest
  ): Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
}

export interface RendererPluginGitFacade {
  abortCherryPick(cwd: string): Promise<GitSequencerAbortResult>;
  abortMerge(cwd: string): Promise<GitMergeAbortResult>;
  abortRebase(cwd: string): Promise<GitRebaseAbortResult>;
  abortRevert(cwd: string): Promise<GitSequencerAbortResult>;
  applyStash(cwd: string, index?: number): Promise<GitStashApplyResult>;
  cancelReviewRequest(request: GitReviewCancelRequest): Promise<void>;
  checkoutBranch(cwd: string, name: string): Promise<boolean>;
  cherryPick(cwd: string, oid: string): Promise<GitSequencerResult>;
  commit(
    cwd: string,
    options: { allowEmpty?: boolean; message: string; signoff?: boolean }
  ): Promise<boolean>;
  continueCherryPick(cwd: string): Promise<GitSequencerContinueResult>;
  continueRebase(cwd: string): Promise<GitRebaseContinueResult>;
  continueRevert(cwd: string): Promise<GitSequencerContinueResult>;
  createAndSwitchBranch(cwd: string, name: string): Promise<boolean>;
  discardChanges(cwd: string, paths: string[]): Promise<boolean>;
  dropStash(cwd: string, index?: number): Promise<GitStashDropResult>;
  getDiffPatch(
    cwd: string,
    options?: {
      from?: string;
      path?: string;
      paths?: string[];
      staged?: boolean;
      to?: string;
    }
  ): Promise<GitDiffPatch>;
  getDiffText(
    cwd: string,
    options?: {
      from?: string;
      paths?: string[];
      staged?: boolean;
      to?: string;
    }
  ): Promise<string>;
  getFileContent(
    cwd: string,
    options: { path: string; ref?: string }
  ): Promise<string>;
  getLog(
    cwd: string,
    options?: {
      author?: string;
      grep?: string;
      maxCount?: number;
      path?: string;
      since?: string;
      until?: string;
    }
  ): Promise<GitCommit[]>;
  getRepoInfo(cwd: string): Promise<GitRepoInfo>;
  getReviewFileDocument(
    request: GitReviewFileDocumentRequest
  ): Promise<GitReviewFileDocumentResult>;
  getReviewIndex(request: GitReviewIndexRequest): Promise<GitReviewIndexResult>;
  getStatus(cwd: string): Promise<GitStatus>;
  listBranches(
    cwd: string,
    options: { kind: "all" | "local" | "remote" }
  ): Promise<GitBranchRef[]>;
  /** gitignore 命中路径(相对 gitRoot;目录折叠为 `dir/`)。 */
  listIgnored(cwd: string): Promise<string[]>;
  listStashes(cwd: string): Promise<GitStashListResult>;
  merge(cwd: string, branch: string): Promise<GitMergeResult>;
  popStash(cwd: string, index?: number): Promise<GitStashPopResult>;
  pullFastForward(cwd: string): Promise<GitRemoteOperationResult>;
  push(cwd: string): Promise<GitRemoteOperationResult>;
  rebase(cwd: string, branch: string): Promise<GitRebaseResult>;
  revert(cwd: string, oid: string): Promise<GitSequencerResult>;
  searchBranches(
    cwd: string,
    options?: {
      currentBranch?: null | string;
      diffMode?: "commitGraph" | "mergeIntoCurrent";
      limit?: number;
      query?: string;
    }
  ): Promise<GitDiffBranchesResult>;
  /** 结构化 commit 搜索(hash/@author/:path/~pickaxe/since:/until:/all:)。 */
  searchCommits(
    cwd: string,
    options?: { limit?: number; query?: string }
  ): Promise<GitCommitSearchResult>;
  stage(cwd: string, paths: string[]): Promise<boolean>;
  stash(
    cwd: string,
    options?: { includeUntracked?: boolean; message?: string }
  ): Promise<GitStashResult>;
  sync(cwd: string): Promise<GitRemoteOperationResult>;
  undoLastCommit(cwd: string): Promise<GitUndoCommitResult>;
  unstage(cwd: string, paths: string[]): Promise<boolean>;
  watch(
    gitRoot: string,
    listener: (event: GitChangeEvent) => void,
    onStartFailure?: (error: Error) => void,
    onReady?: () => void
  ): () => void;
}

export interface RendererPluginWorktreesFacade {
  check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
  create(
    request: WorktreeCreateRequest,
    options?: {
      onProgress?: (progress: WorktreeCreateProgress) => void;
    }
  ): Promise<WorktreeCreateResult>;
  creationDefaults(
    request: WorktreeCreationDefaultsRequest
  ): Promise<WorktreeCreationDefaults>;
  list(request: WorktreeListRequest): Promise<WorktreeListResult>;
  open(request: WorktreeOpenRequest): Promise<WorktreeOpenResult>;
  openTerminal(
    request: WorktreeOpenTerminalRequest
  ): Promise<WorktreeOpenTerminalResult>;
  prune(request: WorktreePruneRequest): Promise<WorktreeListResult>;
  remove(request: WorktreeRemoveRequest): Promise<WorktreeRemoveResult>;
}
