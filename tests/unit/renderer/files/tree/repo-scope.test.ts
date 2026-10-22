import type { PierFileTreeGitStatus } from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  buildPrefixedGitStatusByPath,
  mergeGitStatusByPath,
} from "@plugins/builtin/files/renderer/tree/git/decorations.ts";
import { GIT_IGNORED_PROBE_FAILURE_TTL_MS } from "@plugins/builtin/files/renderer/tree/git/ignored-index.ts";
import {
  isPathWithinRepoPrefix,
  prefixRepoPath,
  repoDirectoryAbsolute,
  revealsRepoRoot,
} from "@plugins/builtin/files/renderer/tree/git/repo-scope.ts";
import { FilesTreeVisibilityController } from "@plugins/builtin/files/renderer/tree/visibility.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/workspace/XYZ";
const BACKEND = "ipaas-application-backend";
const FRONTEND = "ipaas-application-frontend";

function entry(
  path: string,
  kind: FileEntry["kind"] = "file",
  root = ROOT
): FileEntry {
  return { kind, path, root };
}

const LISTINGS: Record<string, FileEntry[]> = {
  "": [
    entry(BACKEND, "directory"),
    entry(FRONTEND, "directory"),
    entry("README.md"),
  ],
  [BACKEND]: [
    entry(`${BACKEND}/.git`, "directory"),
    entry(`${BACKEND}/node_modules`, "directory"),
    entry(`${BACKEND}/src`, "directory"),
  ],
  [FRONTEND]: [
    entry(`${FRONTEND}/.git`, "file"),
    entry(`${FRONTEND}/node_modules`, "directory"),
    entry(`${FRONTEND}/src`, "directory"),
  ],
  [`${BACKEND}/src`]: [
    entry(`${BACKEND}/src/main.ts`),
    entry(`${BACKEND}/src/vendor`),
  ],
};

function createMultiRepoContext(options?: {
  ignoredByDirectory?: Record<string, readonly string[] | Error>;
  showExcludedFiles?: boolean;
  showGitIgnoredFiles?: boolean;
}) {
  const list = vi.fn(
    async (_root: string, listOptions?: { path?: string }) =>
      LISTINGS[listOptions?.path ?? ""] ?? []
  );
  const listIgnored = vi.fn(async (cwd: string) => {
    const value = options?.ignoredByDirectory?.[cwd] ?? new Error("not a repo");
    if (value instanceof Error) {
      throw value;
    }
    return [...value];
  });
  const context = {
    configuration: {
      get: vi.fn((key: string) => {
        if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
          return options?.showExcludedFiles ?? false;
        }
        if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
          return FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
        }
        if (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY) {
          return options?.showGitIgnoredFiles ?? false;
        }
        return;
      }),
    },
    files: { list },
    git: { listIgnored },
  } as unknown as RendererPluginContext;
  return { context, list, listIgnored };
}

describe("nested repo scope helpers", () => {
  it("only treats a direct .git child as a repo boundary", () => {
    expect(revealsRepoRoot(BACKEND, LISTINGS[BACKEND] ?? [])).toBe(true);
    expect(revealsRepoRoot(FRONTEND, LISTINGS[FRONTEND] ?? [])).toBe(true);
    // 根级 listing 只看到仓库目录，不把子仓库的 .git 认成自己的
    expect(revealsRepoRoot("", LISTINGS[""] ?? [])).toBe(false);
    expect(revealsRepoRoot(BACKEND, [entry(`${BACKEND}/src/.git`)])).toBe(
      false
    );
  });

  it("maps repo-relative paths onto the tree root", () => {
    expect(prefixRepoPath("", "node_modules")).toBe("node_modules");
    expect(prefixRepoPath(BACKEND, "node_modules/")).toBe(
      `${BACKEND}/node_modules/`
    );
    expect(repoDirectoryAbsolute(ROOT, "")).toBe(ROOT);
    expect(repoDirectoryAbsolute(`${ROOT}/`, BACKEND)).toBe(
      `${ROOT}/${BACKEND}`
    );
  });

  it("treats every path as inside the root repo prefix", () => {
    expect(isPathWithinRepoPrefix("a/b", "")).toBe(true);
    expect(isPathWithinRepoPrefix(BACKEND, BACKEND)).toBe(true);
    expect(isPathWithinRepoPrefix(`${BACKEND}/src`, BACKEND)).toBe(true);
    expect(isPathWithinRepoPrefix(`${BACKEND}2/src`, BACKEND)).toBe(false);
  });
});

describe("multi-repo parent ignore resolution", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps nested repo ignores valid after a failed root probe expires", async () => {
    const { context } = createMultiRepoContext({
      ignoredByDirectory: { [`${ROOT}/${BACKEND}`]: ["node_modules/"] },
    });
    const controller = new FilesTreeVisibilityController(context);
    await controller.list(ROOT, { path: BACKEND });

    const ignoredPath = `${BACKEND}/node_modules`;
    expect(controller.isPathVisible(ROOT, ignoredPath)).toBe(false);

    // 「根不是仓库」是多仓库父目录的常态。根探测失败不能把已经拿到仓库索引
    // 的整份聚合打成过期，否则 30 秒后忽略规则会短暂失效。
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + GIT_IGNORED_PROBE_FAILURE_TTL_MS * 2);
    expect(controller.isPathVisible(ROOT, ignoredPath)).toBe(false);
  });

  it("applies each nested repo's ignore rules to its own subtree", async () => {
    const { context, listIgnored } = createMultiRepoContext({
      ignoredByDirectory: {
        [`${ROOT}/${BACKEND}`]: ["node_modules/"],
        [`${ROOT}/${FRONTEND}`]: ["node_modules/"],
      },
    });
    const controller = new FilesTreeVisibilityController(context);

    const rootEntries = await controller.list(ROOT);
    expect(rootEntries.map((item) => item.path)).toEqual([
      BACKEND,
      FRONTEND,
      "README.md",
    ]);
    expect(controller.repoPrefixes(ROOT)).toEqual([""]);

    const backendEntries = await controller.list(ROOT, { path: BACKEND });
    // `.git` 被默认排除规则挡掉；`node_modules` 被这个仓库自己的忽略规则挡住。
    expect(backendEntries.map((item) => item.path)).toEqual([`${BACKEND}/src`]);
    expect(listIgnored).toHaveBeenCalledWith(`${ROOT}/${BACKEND}`);

    // 另一个仓库的边界还没被发现，索引里只有已知仓库
    expect(controller.repoPrefixes(ROOT)).toEqual(["", BACKEND]);

    const frontendEntries = await controller.list(ROOT, { path: FRONTEND });
    expect(frontendEntries.map((item) => item.path)).toEqual([
      `${FRONTEND}/src`,
    ]);
    expect(controller.repoPrefixes(ROOT)).toEqual(["", BACKEND, FRONTEND]);
  });

  it("keeps repo prefixes stable between listings so stores do not churn", async () => {
    const { context } = createMultiRepoContext({
      ignoredByDirectory: { [`${ROOT}/${BACKEND}`]: ["node_modules/"] },
    });
    const controller = new FilesTreeVisibilityController(context);
    await controller.list(ROOT, { path: BACKEND });

    const first = controller.repoPrefixes(ROOT);
    const second = controller.repoPrefixes(ROOT);
    expect(second).toBe(first);
  });

  it("notifies subscribers exactly once per discovered repo", async () => {
    const { context } = createMultiRepoContext({
      ignoredByDirectory: { [`${ROOT}/${BACKEND}`]: ["node_modules/"] },
    });
    const controller = new FilesTreeVisibilityController(context);
    const listener = vi.fn();
    controller.subscribeRepoPrefixes(ROOT, listener);

    await controller.list(ROOT);
    expect(listener).not.toHaveBeenCalled();

    await controller.list(ROOT, { path: BACKEND });
    await controller.list(ROOT, { path: BACKEND });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still records repo boundaries when ignored files are shown", async () => {
    const { context } = createMultiRepoContext({
      ignoredByDirectory: { [`${ROOT}/${BACKEND}`]: ["node_modules/"] },
      showGitIgnoredFiles: true,
    });
    const controller = new FilesTreeVisibilityController(context);

    const entries = await controller.list(ROOT, { path: BACKEND });
    expect(entries.map((item) => item.path)).toContain(
      `${BACKEND}/node_modules`
    );
    expect(controller.repoPrefixes(ROOT)).toEqual(["", BACKEND]);
  });

  it("reports whether the tree root itself is a repo", async () => {
    const repoRoot = createMultiRepoContext({
      ignoredByDirectory: { [ROOT]: ["dist/"] },
    });
    const repoController = new FilesTreeVisibilityController(repoRoot.context);
    await repoController.list(ROOT);
    expect(repoController.isRootRepo(ROOT)).toBe(true);

    const parentRoot = createMultiRepoContext();
    const parentController = new FilesTreeVisibilityController(
      parentRoot.context
    );
    await parentController.list(ROOT);
    expect(parentController.isRootRepo(ROOT)).toBe(false);
  });
});

describe("multi-repo status aggregation", () => {
  it("rewrites each repo's paths onto the tree root before merging", () => {
    const backend = buildPrefixedGitStatusByPath(BACKEND, [
      { index: ".", origPath: null, path: "src/main.ts", worktree: "M" },
    ]);
    const frontend = buildPrefixedGitStatusByPath(FRONTEND, [
      { index: "?", origPath: null, path: "src/app.tsx", worktree: "?" },
    ]);
    expect(backend.get(`${BACKEND}/src/main.ts`)).toBe("modified");
    expect(backend.get(BACKEND)).toBe("modified");
    expect(frontend.get(`${FRONTEND}/src/app.tsx`)).toBe("untracked");

    const merged = new Map<string, PierFileTreeGitStatus>();
    mergeGitStatusByPath(merged, backend);
    mergeGitStatusByPath(merged, frontend);
    expect(merged.get(`${BACKEND}/src/main.ts`)).toBe("modified");
    expect(merged.get(`${FRONTEND}/src/app.tsx`)).toBe("untracked");
    // 不同仓库的同名路径不会互相覆盖
    expect(merged.size).toBe(6);
  });

  it("does not downgrade a concrete status to modified when merging", () => {
    const merged = new Map([["src/a.ts", "untracked" as const]]);
    mergeGitStatusByPath(merged, new Map([["src/a.ts", "modified" as const]]));
    expect(merged.get("src/a.ts")).toBe("untracked");
  });
});
