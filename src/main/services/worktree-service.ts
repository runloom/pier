import { mkdir as fsMkdir, realpath as fsRealpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeItem,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOperationErrorReason,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { execGit } from "./git-exec.ts";

const SAFE_WORKTREE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface WorktreeService {
  check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
  create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>;
  list(request: WorktreeListRequest): Promise<WorktreeListResult>;
  remove(request: WorktreeRemoveRequest): Promise<WorktreeRemoveResult>;
}

export interface CreateWorktreeServiceOptions {
  execGit?: (
    args: readonly string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>;
  mkdir?: (path: string) => Promise<void>;
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

function shortBranchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function emptyItem(path: string, isMain: boolean): WorktreeItem {
  return {
    bare: false,
    branch: null,
    detached: false,
    head: null,
    isCurrent: false,
    isMain,
    locked: false,
    lockedReason: null,
    path,
    prunable: false,
    prunableReason: null,
  };
}

function finalizeItem(
  items: WorktreeItem[],
  item: WorktreeItem | null,
  currentPath: string | undefined
): void {
  if (!item) {
    return;
  }
  items.push({
    ...item,
    isCurrent: currentPath === item.path,
  });
}

function parseFlagWithReason(line: string, flag: string): string | null {
  if (line === flag) {
    return null;
  }
  return line.startsWith(`${flag} `) ? line.slice(flag.length + 1) : null;
}

function applyWorktreeLine(item: WorktreeItem, line: string): void {
  if (line.startsWith("HEAD ")) {
    item.head = line.slice("HEAD ".length);
    return;
  }
  if (line.startsWith("branch ")) {
    item.branch = shortBranchName(line.slice("branch ".length));
    return;
  }
  if (line === "bare") {
    item.bare = true;
    return;
  }
  if (line === "detached") {
    item.detached = true;
    item.branch = null;
    return;
  }

  const lockedReason = parseFlagWithReason(line, "locked");
  if (lockedReason !== null || line === "locked") {
    item.locked = true;
    item.lockedReason = lockedReason;
    return;
  }

  const prunableReason = parseFlagWithReason(line, "prunable");
  if (prunableReason !== null || line === "prunable") {
    item.prunable = true;
    item.prunableReason = prunableReason;
  }
}

export function parseGitWorktreeListPorcelainZ(
  output: string,
  currentPath?: string
): WorktreeItem[] {
  const items: WorktreeItem[] = [];
  let current: WorktreeItem | null = null;

  // Git's -z format keeps records NUL-delimited while attributes remain line-based.
  const lines = output
    .split("\0")
    .flatMap((chunk) => chunk.split("\n"))
    .map((line) => line.trimEnd());

  for (const line of lines) {
    if (line.length === 0) {
      finalizeItem(items, current, currentPath);
      current = null;
      continue;
    }

    if (line.startsWith("worktree ")) {
      finalizeItem(items, current, currentPath);
      current = emptyItem(line.slice("worktree ".length), items.length === 0);
      continue;
    }

    if (!current) {
      continue;
    }

    applyWorktreeLine(current, line);
  }

  finalizeItem(items, current, currentPath);
  return items;
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

    // Pier-owned worktrees live under the main checkout so Git remains the source of truth.
    const targetPath = join(before.mainPath, ".worktrees", request.name);
    await mkdir(join(before.mainPath, ".worktrees"));
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
    request: WorktreeRemoveRequest
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

    // Safe remove only covers Pier-managed linked worktrees and delegates deletion to Git.
    const managedRoot = await safeRealpath(
      join(before.mainPath, ".worktrees"),
      realpath
    );
    if (!isInsideDirectory(target.path, managedRoot)) {
      serviceError(
        "unsafe_path",
        `worktree is outside Pier-managed directory: ${target.path}`
      );
    }

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

    const after = await list({ path: before.mainPath });
    if (after.status === "unavailable") {
      serviceError(after.reason, "removed worktree but list failed");
    }
    return {
      removedPath: target.path,
      worktrees: after.worktrees,
    };
  }

  return { check, create, list, remove };
}
