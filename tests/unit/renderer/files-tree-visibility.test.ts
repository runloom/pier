import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FilesTreeVisibilityController,
  isDefaultExcludedFileTreePath,
  parseFilesTreeExcludePatterns,
} from "@plugins/builtin/files/renderer/files-tree-visibility.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { describe, expect, it, vi } from "vitest";

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
          return options?.showGitIgnoredFiles ?? true;
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

  it("hides default exclusions without hiding developer dotfiles", async () => {
    const { context, listIgnored } = createContext();
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

  it("degrades to default exclusions when Git ignore lookup is unavailable", async () => {
    const { context } = createContext({
      ignored: new Error("not a Git repository"),
      showGitIgnoredFiles: false,
    });
    const controller = new FilesTreeVisibilityController(context);

    const paths = (await controller.list(ROOT)).map((item) => item.path);

    expect(paths).toContain("dist");
    expect(paths).toContain(".env");
    expect(paths).not.toContain(".git");
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
});
