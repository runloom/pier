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
  FileSaveTargetRequest,
  FileSaveTargetResult,
} from "@shared/contracts/file-save-target.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import type {
  GitBranchRef,
  GitChangeEvent,
  GitDiffBranchesResult,
  GitDiffPatch,
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
  WorktreeCheckRequest,
  WorktreeCheckResult,
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
  pickSaveTarget(request: FileSaveTargetRequest): Promise<FileSaveTargetResult>;
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
  abortMerge(cwd: string): Promise<GitMergeAbortResult>;
  abortRebase(cwd: string): Promise<GitRebaseAbortResult>;
  applyStash(cwd: string, index?: number): Promise<GitStashApplyResult>;
  checkoutBranch(cwd: string, name: string): Promise<boolean>;
  continueRebase(cwd: string): Promise<GitRebaseContinueResult>;
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
  getFileContent(
    cwd: string,
    options: { path: string; ref?: string }
  ): Promise<string>;
  getRepoInfo(cwd: string): Promise<GitRepoInfo>;
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
  searchBranches(
    cwd: string,
    options?: {
      currentBranch?: null | string;
      diffMode?: "commitGraph" | "mergeIntoCurrent";
      limit?: number;
      query?: string;
    }
  ): Promise<GitDiffBranchesResult>;
  stage(cwd: string, paths: string[]): Promise<boolean>;
  stash(
    cwd: string,
    options?: { includeUntracked?: boolean; message?: string }
  ): Promise<GitStashResult>;
  sync(cwd: string): Promise<GitRemoteOperationResult>;
  undoLastCommit(cwd: string): Promise<GitUndoCommitResult>;
  unstage(cwd: string, paths: string[]): Promise<boolean>;
  watch(gitRoot: string, listener: (event: GitChangeEvent) => void): () => void;
}

export interface RendererPluginWorktreesFacade {
  check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
  create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>;
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
