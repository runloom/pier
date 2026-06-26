import { execFile } from "node:child_process";
import { mkdir as fsMkdir, realpath as fsRealpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeItem,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeUnavailableReason,
} from "@shared/contracts/worktree.ts";

const execFileAsync = promisify(execFile);
const SAFE_WORKTREE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface WorktreeService {
  create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>;
  list(request: WorktreeListRequest): Promise<WorktreeListResult>;
}

export interface CreateWorktreeServiceOptions {
  execGit?: (args: readonly string[], cwd: string) => Promise<string>;
  mkdir?: (path: string) => Promise<void>;
  realpath?: (path: string) => Promise<string>;
}

class WorktreeServiceError extends Error {
  readonly reason: WorktreeUnavailableReason;

  constructor(reason: WorktreeUnavailableReason, message: string) {
    super(message);
    this.name = "WorktreeServiceError";
    this.reason = reason;
  }
}

async function defaultExecGit(
  args: readonly string[],
  cwd: string
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return stdout;
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
  reason: WorktreeUnavailableReason,
  message: string
): never {
  throw new WorktreeServiceError(reason, message);
}

export function createWorktreeService({
  execGit = defaultExecGit,
  mkdir = async (path) => {
    await fsMkdir(path, { recursive: true });
  },
  realpath = fsRealpath,
}: CreateWorktreeServiceOptions = {}): WorktreeService {
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
    } catch {
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
      before.mainPath
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

  return { create, list };
}
