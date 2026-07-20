import { mkdir as fsMkdir, realpath as fsRealpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOperationErrorReason,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { execGit } from "./git-exec.ts";
import { parseGitWorktreeListPorcelainZ } from "./worktree-parser.ts";

const SAFE_WORKTREE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

interface WorktreeRootPreferences {
  worktreeRootPath: string;
}

export interface WorktreeRemoveHooks {
  beforeRemove?: (target: {
    mainPath: string;
    targetPath: string;
  }) => Promise<void>;
}

export interface WorktreeService {
  check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
  create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>;
  list(request: WorktreeListRequest): Promise<WorktreeListResult>;
  prune(request: WorktreePruneRequest): Promise<WorktreeListResult>;
  remove(
    request: WorktreeRemoveRequest,
    hooks?: WorktreeRemoveHooks
  ): Promise<WorktreeRemoveResult>;
  resolveRootPath(request: WorktreeListRequest): Promise<string>;
}

export interface CreateWorktreeServiceOptions {
  execGit?: (
    args: readonly string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>;
  mkdir?: (path: string) => Promise<void>;
  readPreferences?: () => Promise<WorktreeRootPreferences>;
  realpath?: (path: string) => Promise<string>;
}

export class WorktreeServiceError extends Error {
  readonly reason: WorktreeOperationErrorReason;

  constructor(reason: WorktreeOperationErrorReason, message: string) {
    super(message);
    this.name = "WorktreeServiceError";
    this.reason = reason;
  }
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

async function safeRealpath(
  path: string,
  realpath: (path: string) => Promise<string>
): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function safeDirectoryName(name: string): boolean {
  return (
    name !== "." &&
    name !== ".." &&
    SAFE_WORKTREE_NAME_PATTERN.test(name) &&
    !name.includes("/")
  );
}

function serviceError(
  reason: WorktreeOperationErrorReason,
  message: string
): never {
  throw new WorktreeServiceError(reason, message);
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

function isInsideDirectory(child: string, parent: string): boolean {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function defaultWorktreeRoot(mainPath: string): string {
  return join(dirname(mainPath), `${basename(mainPath)}.worktree`);
}

export function resolveWorktreeRootPath(
  mainPath: string,
  configuredRootPath: string
): string {
  const rootPath = configuredRootPath.trim();
  if (rootPath.length === 0) {
    return defaultWorktreeRoot(mainPath);
  }
  return isAbsolute(rootPath)
    ? resolve(rootPath)
    : resolve(dirname(mainPath), rootPath);
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

async function validateBranchName(
  branch: string,
  cwd: string,
  execGit: (args: readonly string[], cwd: string) => Promise<string>
): Promise<void> {
  try {
    await execGit(["check-ref-format", "--branch", branch], cwd);
  } catch {
    serviceError("invalid_branch", `invalid worktree branch: ${branch}`);
  }
}

export function createWorktreeService({
  execGit = defaultExecGit,
  mkdir = async (path) => {
    await fsMkdir(path, { recursive: true });
  },
  readPreferences = async () => ({ worktreeRootPath: "" }),
  realpath = fsRealpath,
}: CreateWorktreeServiceOptions = {}): WorktreeService {
  async function check({
    path,
  }: WorktreeCheckRequest): Promise<WorktreeCheckResult> {
    const result = await list({ path });
    if (result.status === "unavailable") {
      return {
        path: result.path,
        reason: result.reason,
        status: "unsupported",
      };
    }
    return {
      ...(result.currentPath ? { currentPath: result.currentPath } : {}),
      mainPath: result.mainPath,
      path: result.path,
      status: "supported",
    };
  }

  async function list({
    path,
  }: WorktreeListRequest): Promise<WorktreeListResult> {
    const resolvedPath = await safeRealpath(path, realpath);
    let currentPath: string;
    try {
      currentPath = (
        await execGit(["rev-parse", "--show-toplevel"], resolvedPath)
      ).trim();
    } catch {
      return {
        path: resolvedPath,
        reason: "not_git_repo",
        status: "unavailable",
        worktrees: [],
      };
    }

    const realCurrentPath = await safeRealpath(currentPath, realpath);
    let output: string;
    try {
      output = await execGit(
        ["worktree", "list", "--porcelain", "-z"],
        realCurrentPath
      );
    } catch (err) {
      console.warn(
        "[worktree-service] worktree list failed:",
        err instanceof Error ? err.message : err
      );
      return {
        path: resolvedPath,
        reason: "git_unavailable",
        status: "unavailable",
        worktrees: [],
      };
    }

    const worktrees = parseGitWorktreeListPorcelainZ(output, realCurrentPath);
    const mainPath = worktrees[0]?.path;
    if (!mainPath) {
      return {
        path: resolvedPath,
        reason: "git_unavailable",
        status: "unavailable",
        worktrees: [],
      };
    }

    return {
      currentPath: realCurrentPath,
      mainPath,
      path: resolvedPath,
      status: "available",
      worktrees,
    };
  }

  async function resolveRootPath({
    path,
  }: WorktreeListRequest): Promise<string> {
    const result = await list({ path });
    if (result.status === "unavailable") {
      serviceError(result.reason, `cannot resolve worktree root from ${path}`);
    }
    const preferences = await readPreferences();
    return resolveWorktreeRootPath(
      result.mainPath,
      preferences.worktreeRootPath
    );
  }

  async function managedRoots(mainPath: string): Promise<string[]> {
    const preferences = await readPreferences();
    return uniquePaths([
      resolveWorktreeRootPath(mainPath, preferences.worktreeRootPath),
      defaultWorktreeRoot(mainPath),
      join(mainPath, ".worktrees"),
    ]);
  }

  async function isInsideManagedRoot(
    targetPath: string,
    mainPath: string
  ): Promise<boolean> {
    for (const rootPath of await managedRoots(mainPath)) {
      const managedRoot = await safeRealpath(rootPath, realpath);
      if (isInsideDirectory(targetPath, managedRoot)) {
        return true;
      }
    }
    return false;
  }

  async function create(
    request: WorktreeCreateRequest
  ): Promise<WorktreeCreateResult> {
    if (!safeDirectoryName(request.name)) {
      serviceError("invalid_name", `invalid worktree name: ${request.name}`);
    }

    const before = await list({ path: request.path });
    if (before.status === "unavailable") {
      serviceError(
        before.reason,
        `cannot create worktree from ${request.path}`
      );
    }
    await validateBranchName(request.branch, before.mainPath, execGit);

    const rootPath = await resolveRootPath({ path: before.mainPath });
    const targetPath = join(rootPath, request.name);
    await mkdir(rootPath);
    await execGit(
      [
        "worktree",
        "add",
        "-b",
        request.branch,
        targetPath,
        ...(request.base ? [request.base] : []),
      ],
      before.mainPath,
      { timeoutMs: 60_000 }
    );

    const after = await list({ path: targetPath });
    if (after.status === "unavailable") {
      serviceError(
        after.reason,
        `created worktree is unavailable: ${targetPath}`
      );
    }
    const created = after.worktrees.find((item) => item.path === targetPath);
    if (!created) {
      serviceError(
        "git_unavailable",
        `created worktree not found: ${targetPath}`
      );
    }
    return {
      created,
      targetPath,
      worktrees: after.worktrees,
    };
  }

  async function remove(
    request: WorktreeRemoveRequest,
    hooks?: WorktreeRemoveHooks
  ): Promise<WorktreeRemoveResult> {
    const targetPath = await safeRealpath(request.path, realpath);
    const before = await list({ path: targetPath });
    if (before.status === "unavailable") {
      serviceError(before.reason, `cannot remove worktree at ${request.path}`);
    }

    const target = before.worktrees.find((item) =>
      samePath(item.path, targetPath)
    );
    if (!target) {
      serviceError("not_found", `worktree not found: ${request.path}`);
    }
    if (target.isMain) {
      serviceError("main_worktree", "cannot remove the main worktree");
    }

    if (request.currentPath) {
      const currentPath = await safeRealpath(request.currentPath, realpath);
      if (samePath(target.path, currentPath)) {
        serviceError("current_worktree", "cannot remove the current worktree");
      }
    }

    if (!(await isInsideManagedRoot(target.path, before.mainPath))) {
      serviceError(
        "unsafe_path",
        `worktree is outside Pier-managed directory: ${target.path}`
      );
    }

    await hooks?.beforeRemove?.({
      mainPath: before.mainPath,
      targetPath: target.path,
    });

    try {
      await execGit(["worktree", "remove", target.path], before.mainPath, {
        timeoutMs: 60_000,
      });
    } catch (err) {
      serviceError(
        "git_unavailable",
        err instanceof Error ? err.message : String(err)
      );
    }

    // 分支删除只走安全模式(-d):未合并分支失败并回传原因,不使用 -D。
    let branchDeletion: WorktreeRemoveResult["branchDeletion"] = null;
    if (request.deleteBranch && target.branch) {
      try {
        await execGit(["branch", "-d", target.branch], before.mainPath, {
          timeoutMs: 60_000,
        });
        branchDeletion = {
          branch: target.branch,
          deleted: true,
          message: null,
        };
      } catch (err) {
        branchDeletion = {
          branch: target.branch,
          deleted: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const after = await list({ path: before.mainPath });
    if (after.status === "unavailable") {
      serviceError(after.reason, "removed worktree but list failed");
    }
    return {
      branchDeletion,
      removedPath: target.path,
      worktrees: after.worktrees,
    };
  }

  async function prune(
    request: WorktreePruneRequest
  ): Promise<WorktreeListResult> {
    const before = await list({ path: request.path });
    if (before.status === "unavailable") {
      return before;
    }
    await execGit(["worktree", "prune"], before.mainPath, {
      timeoutMs: 60_000,
    });
    return await list({ path: before.mainPath });
  }

  return { check, create, list, prune, remove, resolveRootPath };
}
