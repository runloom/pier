import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useFilesTreeGitDecorations } from "@plugins/builtin/files/renderer/tree/git/use-decorations.ts";
import { FilesTreeVisibilityController } from "@plugins/builtin/files/renderer/tree/visibility.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { GitChangeEvent, GitStatus } from "@shared/contracts/git.ts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/workspace/XYZ";
const BACKEND = "ipaas-application-backend";
const FRONTEND = "ipaas-application-frontend";

function entry(path: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { kind, path, root: ROOT };
}

const LISTINGS: Record<string, FileEntry[]> = {
  "": [entry(BACKEND, "directory"), entry(FRONTEND, "directory")],
  [BACKEND]: [
    entry(`${BACKEND}/.git`, "directory"),
    entry(`${BACKEND}/src`, "directory"),
  ],
  [FRONTEND]: [
    entry(`${FRONTEND}/.git`, "directory"),
    entry(`${FRONTEND}/src`, "directory"),
  ],
};

function status(files: GitStatus["files"]): GitStatus {
  return { files } as GitStatus;
}

function createHarness() {
  const watchers = new Map<string, (event: GitChangeEvent) => void>();
  const list = vi.fn(
    async (_root: string, options?: { path?: string }) =>
      LISTINGS[options?.path ?? ""] ?? []
  );
  const listIgnored = vi.fn(async () => [] as string[]);
  const getStatus = vi.fn(async (cwd: string) => {
    if (cwd === `${ROOT}/${BACKEND}`) {
      return status([
        { index: ".", origPath: null, path: "src/main.ts", worktree: "M" },
      ]);
    }
    if (cwd === `${ROOT}/${FRONTEND}`) {
      return status([
        { index: "?", origPath: null, path: "src/app.tsx", worktree: "?" },
      ]);
    }
    throw new Error("not a repository");
  });
  const watch = vi.fn(
    (cwd: string, listener: (event: GitChangeEvent) => void) => {
      watchers.set(cwd, listener);
      return () => {
        watchers.delete(cwd);
      };
    }
  );
  const context = {
    configuration: {
      get: vi.fn((key: string) => {
        if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
          return false;
        }
        if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
          return FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
        }
        if (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY) {
          return false;
        }
        return;
      }),
    },
    files: { list },
    git: { getStatus, listIgnored, watch },
  } as unknown as RendererPluginContext;
  return { context, watchers };
}

async function discoverBothRepos(controller: FilesTreeVisibilityController) {
  await controller.list(ROOT);
  await controller.list(ROOT, { path: BACKEND });
  await controller.list(ROOT, { path: FRONTEND });
}

describe("useFilesTreeGitDecorations", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("merges status from every repo under a multi-repo parent", async () => {
    const { context } = createHarness();
    const controller = new FilesTreeVisibilityController(context);
    await discoverBothRepos(controller);

    const { result } = renderHook(() =>
      useFilesTreeGitDecorations({
        context,
        reloadTreeVisibility: async () => undefined,
        root: ROOT,
        treeVisibility: controller,
      })
    );

    await waitFor(() => {
      expect(result.current.changedByPath.get(`${BACKEND}/src/main.ts`)).toBe(
        "modified"
      );
    });
    expect(result.current.changedByPath.get(`${FRONTEND}/src/app.tsx`)).toBe(
      "untracked"
    );
    // 根不是仓库，不在根上订阅状态
    expect(result.current.changedByPath.has(ROOT)).toBe(false);
  });

  it("keeps other repos' marks when one repo's watcher fires", async () => {
    const { context, watchers } = createHarness();
    const controller = new FilesTreeVisibilityController(context);
    await discoverBothRepos(controller);

    const { result } = renderHook(() =>
      useFilesTreeGitDecorations({
        context,
        reloadTreeVisibility: async () => undefined,
        root: ROOT,
        treeVisibility: controller,
      })
    );
    await waitFor(() => {
      expect(result.current.changedByPath.get(`${FRONTEND}/src/app.tsx`)).toBe(
        "untracked"
      );
    });

    const frontendWatcher = watchers.get(`${ROOT}/${FRONTEND}`);
    expect(frontendWatcher).toBeDefined();
    act(() => {
      frontendWatcher?.({
        changeKind: "worktree",
        gitRoot: `${ROOT}/${FRONTEND}`,
        status: status([]),
      });
    });

    // 前端自己变干净了，后端标记必须还在
    expect(result.current.changedByPath.has(`${FRONTEND}/src/app.tsx`)).toBe(
      false
    );
    expect(result.current.changedByPath.get(`${BACKEND}/src/main.ts`)).toBe(
      "modified"
    );
  });
});

describe("useFilesTreeGitDecorations with Git-ignored files shown", () => {
  const SINGLE_ROOT = "/workspace/single";
  const SINGLE_ENTRIES: Record<string, FileEntry[]> = {
    "": [
      { kind: "file", path: ".git", root: SINGLE_ROOT },
      { kind: "directory", path: "dist", root: SINGLE_ROOT },
      { kind: "directory", path: "src", root: SINGLE_ROOT },
    ],
    src: [{ kind: "file", path: "src/main.ts", root: SINGLE_ROOT }],
  };

  function createSingleRepoHarness() {
    const list = vi.fn(
      async (_root: string, options?: { path?: string }) =>
        SINGLE_ENTRIES[options?.path ?? ""] ?? []
    );
    const listIgnored = vi.fn(async () => ["dist/"]);
    const getStatus = vi.fn(async () =>
      status([
        { index: ".", origPath: null, path: "src/main.ts", worktree: "M" },
      ])
    );
    const watch = vi.fn(() => () => undefined);
    const context = {
      configuration: {
        get: vi.fn((key: string) => {
          if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
            return false;
          }
          if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
            return FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
          }
          if (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY) {
            return true;
          }
          return;
        }),
      },
      files: { list },
      git: { getStatus, listIgnored, watch },
    } as unknown as RendererPluginContext;
    return { context, getStatus, listIgnored };
  }

  it("still loads the ignore index and status for a repo root", async () => {
    const { context, getStatus, listIgnored } = createSingleRepoHarness();
    const controller = new FilesTreeVisibilityController(context);
    await controller.list(SINGLE_ROOT);

    const { result } = renderHook(() =>
      useFilesTreeGitDecorations({
        context,
        reloadTreeVisibility: async () => undefined,
        root: SINGLE_ROOT,
        treeVisibility: controller,
      })
    );

    // 显示忽略项时 list() 不加载索引；淡化装饰与状态标记仍必须各自到位。
    await waitFor(() => {
      expect(result.current.ignoredDirs).toEqual(["dist"]);
      expect(result.current.changedByPath.get("src/main.ts")).toBe("modified");
    });
    expect(listIgnored).toHaveBeenCalledWith(SINGLE_ROOT);
    expect(getStatus).toHaveBeenCalledWith(SINGLE_ROOT);
  });
});
