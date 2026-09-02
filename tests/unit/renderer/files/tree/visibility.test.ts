import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_IGNORED_PROBE_FAILURE_TTL_MS } from "@plugins/builtin/files/renderer/tree/git-ignored-index.ts";
import {
  FilesTreeVisibilityController,
  isDefaultExcludedFileTreePath,
  parseFilesTreeExcludePatterns,
} from "@plugins/builtin/files/renderer/tree/visibility.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/workspace/pier";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function entry(path: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { kind, path, root: ROOT };
}

function createContext(options?: {
  excludePatterns?: string;
  ignored?: readonly string[] | Error;
  showExcludedFiles?: boolean;
  showGitIgnoredFiles?: boolean;
}) {
  const list = vi.fn(async () => [
    entry(".git", "directory"),
    entry(".env"),
    entry(".github", "directory"),
    entry(".gitignore"),
    entry(".DS_Store"),
    entry("dist", "directory"),
    entry("dist/bundle.js"),
    entry("src", "directory"),
  ]);
  const listIgnored = vi.fn(async () => {
    if (options?.ignored instanceof Error) {
      throw options.ignored;
    }
    return [...(options?.ignored ?? [])];
  });
  const context = {
    configuration: {
      get: vi.fn((key: string) => {
        if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
          return options?.showExcludedFiles ?? false;
        }
        if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
          return (
            options?.excludePatterns ?? FILES_TREE_DEFAULT_EXCLUDE_PATTERNS
          );
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

describe("files tree visibility", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("recognizes VCS internals and OS metadata at any path depth", () => {
    expect(isDefaultExcludedFileTreePath(".git")).toBe(true);
    expect(isDefaultExcludedFileTreePath("packages/demo/.git/config")).toBe(
      true
    );
    expect(isDefaultExcludedFileTreePath("repo/.svn")).toBe(true);
    expect(isDefaultExcludedFileTreePath("repo/.hg/store")).toBe(true);
    expect(isDefaultExcludedFileTreePath("repo/CVS/Entries")).toBe(true);
    expect(isDefaultExcludedFileTreePath("assets/.DS_Store")).toBe(true);
    expect(isDefaultExcludedFileTreePath(".github/workflows/ci.yml")).toBe(
      false
    );
    expect(isDefaultExcludedFileTreePath(".gitignore")).toBe(false);
  });

  it("hides default exclusions and Git ignores independently by default", async () => {
    const { context, listIgnored } = createContext({
      ignored: ["dist/"],
    });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT, { path: "" })).map(
      (item) => item.path
    );

    // Default exclusions hide .git/.DS_Store; Git-ignore hiding is on by
    // default too (dist/ collapsed directory), developer dotfiles stay.
    expect(paths).toEqual([".env", ".github", ".gitignore", "src"]);
    expect(listIgnored).toHaveBeenCalledTimes(1);
  });

  it("shows developer dotfiles when Git ignore hiding is disabled", async () => {
    const { context, listIgnored } = createContext({
      showGitIgnoredFiles: true,
    });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT, { path: "" })).map(
      (item) => item.path
    );

    expect(paths).toEqual([
      ".env",
      ".github",
      ".gitignore",
      "dist",
      "dist/bundle.js",
      "src",
    ]);
    expect(listIgnored).not.toHaveBeenCalled();
  });

  it("can explicitly reveal the default exclusions", async () => {
    const { context } = createContext({ showExcludedFiles: true });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).toContain(".git");
    expect(paths).toContain(".DS_Store");
  });

  it("uses editable glob exclusions and ignores comments and blank lines", async () => {
    const excludePatterns = "# generated output\n\n**/dist\n**/*.generated";
    expect(parseFilesTreeExcludePatterns(excludePatterns)).toEqual([
      "**/dist",
      "**/*.generated",
    ]);
    const { context } = createContext({ excludePatterns });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
    expect(paths).toContain(".git");
    expect(paths).toContain(".DS_Store");
  });

  it("hides Git-ignored entries on the very first listing (no visible flash)", async () => {
    const ignoredLoad = deferred<string[]>();
    const { context, list, listIgnored } = createContext({
      ignored: ["dist/"],
    });
    listIgnored.mockImplementationOnce(() => ignoredLoad.promise);
    const controller = new FilesTreeVisibilityController(context);

    let settled = false;
    const listing = controller.list(ROOT).then((entries) => {
      settled = true;
      return entries.map((item) => item.path);
    });
    await Promise.resolve();
    expect(list).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    ignoredLoad.resolve(["dist/"]);
    const paths = await listing;
    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
  });

  it("re-resolves the ignore index after invalidation instead of listing everything", async () => {
    const { context, listIgnored } = createContext({
      ignored: ["dist/"],
    });
    const controller = new FilesTreeVisibilityController(context);
    expect(
      (await controller.list(ROOT)).map((item) => item.path)
    ).not.toContain("dist");

    // Settings toggle path (use-visibility): invalidate, then reload the tree.
    controller.invalidateGitIgnored(ROOT);
    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
    expect(controller.isPathVisible(ROOT, "dist/bundle.js")).toBe(false);
    expect(listIgnored).toHaveBeenCalledTimes(2);
  });

  it("separately hides exact and directory Git ignore matches", async () => {
    const { context, listIgnored } = createContext({
      ignored: ["dist/", ".env"],
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).toEqual([".github", ".gitignore", "src"]);
    expect(listIgnored).toHaveBeenCalledTimes(1);
    await controller.list(ROOT, { path: "src" });
    expect(listIgnored).toHaveBeenCalledTimes(1);
  });

  it("keeps a pinned ignored file and its ancestor chain visible", async () => {
    const { context } = createContext({
      ignored: ["dist/", ".env"],
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);

    expect(controller.pinPath(ROOT, "dist/bundle.js")).toBe(true);

    const paths = (await controller.list(ROOT)).map((item) => item.path);
    expect(paths).toContain("dist");
    expect(paths).toContain("dist/bundle.js");
    expect(controller.isPathVisible(ROOT, "dist/bundle.js")).toBe(true);
    expect(controller.isPathVisible(ROOT, "dist")).toBe(true);
    // Non-pinned ignored siblings stay hidden.
    expect(controller.isPathVisible(ROOT, ".env")).toBe(false);
  });

  it("re-hides the pinned chain after unpinning", async () => {
    const { context } = createContext({
      ignored: ["dist/"],
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);
    controller.pinPath(ROOT, "dist/bundle.js");
    expect(controller.unpinPath(ROOT, "dist/bundle.js")).toBe(true);
    expect(controller.unpinPath(ROOT, "dist/bundle.js")).toBe(false);

    const paths = (await controller.list(ROOT)).map((item) => item.path);
    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
    expect(controller.isPathVisible(ROOT, "dist/bundle.js")).toBe(false);
  });

  it("never lets pins override explicit exclusion patterns", async () => {
    const { context } = createContext({
      excludePatterns: "# generated output\n**/dist",
      ignored: [],
      showExcludedFiles: false,
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);
    controller.pinPath(ROOT, "dist/bundle.js");

    const paths = (await controller.list(ROOT)).map((item) => item.path);
    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
    expect(controller.isPathVisible(ROOT, "dist/bundle.js")).toBe(false);
  });

  it("degrades to default exclusions when Git ignore lookup is unavailable", async () => {
    const { context, listIgnored } = createContext({
      ignored: new Error("not a Git repository"),
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).toContain("dist");
    expect(paths).toContain(".env");
    expect(paths).not.toContain(".git");
    await controller.list(ROOT, { path: "src" });
    expect(listIgnored).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest Git ignored index when refreshes resolve out of order", async () => {
    const firstIgnoredLoad = deferred<string[]>();
    const secondIgnoredLoad = deferred<string[]>();
    const { context, listIgnored } = createContext({
      showGitIgnoredFiles: false,
    });
    listIgnored
      .mockImplementationOnce(() => firstIgnoredLoad.promise)
      .mockImplementationOnce(() => secondIgnoredLoad.promise);
    const controller = new FilesTreeVisibilityController(context);

    const firstRefresh = controller.refreshGitIgnored(ROOT);
    const secondRefresh = controller.refreshGitIgnored(ROOT);
    secondIgnoredLoad.resolve(["dist/"]);
    await expect(secondRefresh).resolves.toMatchObject({ entries: ["dist/"] });
    firstIgnoredLoad.resolve([".env"]);
    await expect(firstRefresh).resolves.toMatchObject({ entries: ["dist/"] });

    const paths = (await controller.list(ROOT)).map((item) => item.path);
    expect(paths).toContain(".env");
    expect(paths).not.toContain("dist");
    expect(paths).not.toContain("dist/bundle.js");
    expect(listIgnored).toHaveBeenCalledTimes(2);
  });

  it("retries a failed Git ignore probe after the negative-cache TTL", async () => {
    vi.useFakeTimers();
    const { context, listIgnored } = createContext({
      ignored: new Error("not a Git repository"),
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);
    expect((await controller.list(ROOT)).map((item) => item.path)).toContain(
      "dist"
    );
    expect(listIgnored).toHaveBeenCalledTimes(1);

    await controller.list(ROOT, { path: "src" });
    expect(listIgnored).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(GIT_IGNORED_PROBE_FAILURE_TTL_MS);
    listIgnored.mockResolvedValueOnce(["dist/"]);
    const paths = (await controller.list(ROOT)).map((item) => item.path);
    expect(listIgnored).toHaveBeenCalledTimes(2);
    expect(paths).not.toContain("dist");
  });

  it("reports a change when a git event follows an expired negative cache", async () => {
    vi.useFakeTimers();
    const { context, listIgnored } = createContext({
      ignored: new Error("not a Git repository"),
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);
    await controller.list(ROOT);
    // First refresh right after mount: the tree already awaited this index.
    await expect(controller.refreshGitIgnored(ROOT)).resolves.toMatchObject({
      changed: false,
    });

    await vi.advanceTimersByTimeAsync(GIT_IGNORED_PROBE_FAILURE_TTL_MS);
    listIgnored.mockResolvedValue(["dist/"]);
    await expect(controller.refreshGitIgnored(ROOT)).resolves.toMatchObject({
      changed: true,
      entries: ["dist/"],
    });
  });

  it("TTL 到期后 current() 仍保留负缓存基线，git 事件能报 changed", async () => {
    vi.useFakeTimers();
    const { context, listIgnored } = createContext({
      ignored: new Error("not a Git repository"),
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);
    await controller.list(ROOT);
    expect(controller.isPathVisible(ROOT, "dist")).toBe(true);

    await vi.advanceTimersByTimeAsync(GIT_IGNORED_PROBE_FAILURE_TTL_MS);
    expect(controller.isPathVisible(ROOT, "dist")).toBe(true);

    listIgnored.mockResolvedValue(["dist/"]);
    await expect(controller.refreshGitIgnored(ROOT)).resolves.toMatchObject({
      changed: true,
      entries: ["dist/"],
    });
  });
});
