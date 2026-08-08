import type {
  CommentProjectSnapshot,
  CommentsCreateThreadRequest,
  CommentsCreateThreadResult,
  CommentsDeleteCommentRequest,
  CommentsListProjectsRequest,
  CommentsListProjectsResult,
  CommentsUpdateCommentRequest,
  CommentVoidMutationResult,
} from "@shared/contracts/comments/index.ts";
import type {
  EnvironmentSnapshotRequest,
  EnvironmentUpdateRequest,
  EnvironmentWorktreeBindingRequest,
  LocalEnvironmentProject,
  LocalEnvironmentState,
  LocalEnvironmentWorktreeBindingSnapshot,
} from "@shared/contracts/environment.ts";
import type {
  FileContentQueryStartInput,
  FilePathQueryStartInput,
  FileQueryEvent,
} from "@shared/contracts/file/query.ts";
import type {
  FileSaveTargetRequest,
  FileSaveTargetResult,
} from "@shared/contracts/file/save-target.ts";
import type { FileWatchEvent } from "@shared/contracts/file/watch.ts";
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
  GitReviewCancelRequest,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewGroup,
  GitReviewIndexRequest,
  GitReviewIndexResult,
  GitReviewMutationRequest,
  GitReviewMutationResult,
  GitReviewPathMutationRequest,
} from "@shared/contracts/git/review.ts";
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
  /**
   * Subscribe to file query events (path + content: started/batch/done/error).
   * Filter by `queryId` (and batch `mode`) on the caller side.
   */
  onPathQueryEvent(listener: (event: FileQueryEvent) => void): () => void;
  /**
   * 在 files 面板内打开磁盘文件（宿主跨插件入口）。
   * files 插件未启用/未注册时返回 false，不抛。
   */
  openInEditor(request: {
    /** 1-based column within the line; used with `line`. */
    column?: number;
    context?: PanelContext;
    /** 1-based working-tree line to reveal after open. */
    line?: number;
    path: string;
    root: string;
    title?: string;
  }): boolean;
  openPath(request: FileOpenPathRequest): Promise<FileOpenPathResult>;
  pickSaveTarget(request: FileSaveTargetRequest): Promise<FileSaveTargetResult>;
  /**
   * Start a cancellable content query against the main-process file query service.
   * Same session/cancel rules as `queryPaths` (`owner` isolation). Design:
   * docs/superpowers/specs/2026-07-27-files-content-search-design.md
   */
  queryContents(
    request: Omit<FileContentQueryStartInput, "queryId" | "mode"> & {
      queryId?: string;
    }
  ): { cancel(): void; queryId: string; started: Promise<boolean> };
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
  applyReviewMutation(
    request: GitReviewMutationRequest
  ): Promise<GitReviewMutationResult>;
  applyReviewPathMutation(
    request: GitReviewPathMutationRequest
  ): Promise<GitReviewMutationResult>;
  applyStash(cwd: string, index?: number): Promise<GitStashApplyResult>;

  cancelReviewRequest(request: GitReviewCancelRequest): Promise<void>;
  checkoutBranch(cwd: string, name: string): Promise<GitCheckoutResult>;
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
  fetch(cwd: string): Promise<GitRemoteOperationResult>;
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
  /**
   * 宿主级打开/聚焦 uncommitted Git Changes（不经 plugin panels 越权断言）。
   * 可选 pendingReveal 滚到 path+line（与评论跳转同构）。
   * git 插件未注册时返回 false。
   */
  openUncommittedChanges(input: {
    panelContext: PanelContext;
    pendingReveal?: {
      /** true：group 缺失/无 section 时回退 entry 上存在的 slot（gutter 用） */
      allowGroupFallback?: boolean;
      group?: GitReviewGroup;
      line: number;
      path: string;
      side: "new" | "old";
    } | null;
  }): boolean;
  popStash(cwd: string, index?: number): Promise<GitStashPopResult>;
  publish(cwd: string): Promise<GitRemoteOperationResult>;
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

/**
 * 统一评论能力门面(对应 main 进程 CommentsService;插件按 manifest 声明的
 * comments:read / comments:write capability 调用)。
 *
 * v1 瘦身(对标 Codex 单条批注):只暴露 snapshot / watch / listProjects /
 * createThread / updateComment / deleteComment。
 *
 * - 读路径:snapshot + watch + listProjects 断言 comments:read。
 * - 写路径:createThread / updateComment / deleteComment 断言 comments:read +
 *   comments:write。
 * - 结果透传 {kind:"ok",...} | CommentFailure 联合;snapshot 失败返回 null。
 */
export interface RendererPluginCommentsFacade {
  createThread(
    request: CommentsCreateThreadRequest
  ): Promise<CommentsCreateThreadResult>;
  deleteComment(
    request: CommentsDeleteCommentRequest
  ): Promise<CommentVoidMutationResult>;
  listProjects(
    request: CommentsListProjectsRequest
  ): Promise<CommentsListProjectsResult>;
  /** 首拉项目快照;失败返回 null(不抛,对齐 git facade 单值返回)。 */
  snapshot(worktreeKey: string): Promise<CommentProjectSnapshot | null>;
  /** 原地改正文;成功后 main 置 editedAt 并广播新快照。 */
  updateComment(
    request: CommentsUpdateCommentRequest
  ): Promise<CommentVoidMutationResult>;
  /** 订阅 per-worktree 评论广播;返回 disposer。listener 仅收该 worktreeKey 快照。 */
  watch(
    worktreeKey: string,
    listener: (snapshot: CommentProjectSnapshot) => void
  ): () => void;
}
