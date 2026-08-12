import { mkdir as fsMkdir, realpath as fsRealpath } from "node:fs/promises";
import { join } from "node:path";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeGetRequest,
  WorktreeGetResult,
  WorktreeItem,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOperationErrorReason,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { execGit } from "../exec.ts";
import { attachWorktreeRefs } from "./enrich.ts";
import {
  createWorktreeIncarnationStore,
  type WorktreeIncarnationStore,
} from "./incarnation-store.ts";
import { parseGitWorktreeListPorcelainZ } from "./parser.ts";
import {
  defaultWorktreeRoot,
  isInsideDirectory,
  resolveWorktreeRootPath,
  safeRealpath,
  samePath,
  uniquePaths,
} from "./paths.ts";

export { resolveWorktreeRootPath } from "./paths.ts";

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
  get(request: WorktreeGetRequest): Promise<WorktreeGetResult>;
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
  /** 测试可注入内存 incarnation store 工厂 */
  incarnationStoreForMain?: (mainPath: string) => WorktreeIncarnationStore;
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

async function validateBranchName(
  branch: string,
  cwd: string,
  runGit: (args: readonly string[], cwd: string) => Promise<string>
): Promise<void> {
  try {
    await runGit(["check-ref-format", "--branch", branch], cwd);
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
  incarnationStoreForMain = createWorktreeIncarnationStore(),
}: CreateWorktreeServiceOptions = {}): WorktreeService {
  async function attachRefs(
    mainPath: string,
    items: readonly WorktreeItem[],
    mode: "ensure" | "mint",
    mintPath?: string
  ): Promise<WorktreeItem[]> {
    const mainKey = await safeRealpath(mainPath, realpath);
    return attachWorktreeRefs({
      mainPath: mainKey,
      items,
      store: incarnationStoreForMain(mainKey),
      mode,
      mintPath,
      realpath: (p) => safeRealpath(p, realpath),
    });
  }

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

    const rawWorktrees = parseGitWorktreeListPorcelainZ(
      output,
      realCurrentPath
    );
    const mainPath = rawWorktrees[0]?.path;
    if (!mainPath) {
      return {
        path: resolvedPath,
        reason: "git_unavailable",
        status: "unavailable",
        worktrees: [],
      };
    }

    const worktrees = await attachRefs(mainPath, rawWorktrees, "ensure");
    return {
      currentPath: realCurrentPath,
      mainPath,
      path: resolvedPath,
      status: "available",
      worktrees,
    };
  }

  async function get({ path }: WorktreeGetRequest): Promise<WorktreeGetResult> {
    const resolvedPath = await safeRealpath(path, realpath);
    const result = await list({ path: resolvedPath });
    if (result.status === "unavailable") {
      return {
        status: "unavailable",
        path: resolvedPath,
        reason: result.reason,
      };
    }
    const item = result.worktrees.find((w) => samePath(w.path, resolvedPath));
    if (!item?.worktreeRef) {
      return { status: "not_found", path: resolvedPath };
    }
    return {
      status: "found",
      item,
      worktreeRef: item.worktreeRef,
      canonicalPath: item.canonicalPath ?? item.path,
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
    // 始终建新本地分支；base 只作起点 commit-ish。
    // 显式 --no-track：即使 base 是 origin/main 等远程跟踪分支，也不把
    // 新分支的 upstream 绑到 base（Git 默认会对 remote-tracking start-point
    // 自动 --track，会把「从 main 拉出的 feature」误标成跟踪 origin/main）。
    // 上游应在首次 push -u 时再建立到同名远程分支。
    await execGit(
      [
        "worktree",
        "add",
        "--no-track",
        "-b",
        request.branch,
        targetPath,
        ...(request.base ? [request.base] : []),
      ],
      before.mainPath,
      { timeoutMs: 60_000 }
    );

    // git worktree list 输出 realpath（macOS 上 /var → /private/var）；
    // join 出的 targetPath 可能仍是非 canonical 形式，禁止用 === 比对。
    const realTargetPath = await safeRealpath(targetPath, realpath);
    const after = await list({ path: realTargetPath });
    if (after.status === "unavailable") {
      serviceError(
        after.reason,
        `created worktree is unavailable: ${realTargetPath}`
      );
    }
    // create：list 已 ensure；对目标路径再 mint 覆盖，保证重建换代
    const mintPath = after.worktrees.find((item) =>
      samePath(item.path, realTargetPath)
    )?.path;
    const worktrees = await attachRefs(
      after.mainPath,
      after.worktrees,
      "mint",
      mintPath ?? realTargetPath
    );
    const created = worktrees.find((item) =>
      samePath(item.path, realTargetPath)
    );
    if (!created) {
      serviceError(
        "git_unavailable",
        `created worktree not found: ${realTargetPath}`
      );
    }
    return {
      created,
      // 对外统一返回 list/git 侧一致的 canonical 路径，避免后续 open/bind 分叉。
      targetPath: created.path,
      worktrees,
      ...(created.worktreeRef ? { worktreeRef: created.worktreeRef } : {}),
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

    const mainKey = await safeRealpath(before.mainPath, realpath);
    const store = incarnationStoreForMain(mainKey);
    await store.forget(target.path);

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

  return { check, create, get, list, prune, remove, resolveRootPath };
}
