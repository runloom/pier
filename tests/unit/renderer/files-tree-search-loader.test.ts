import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { loadFilesTreeForSearch } from "@plugins/builtin/files/renderer/files-tree-search-loader.ts";
import {
  clearFilesTreeStore,
  getFilesTreeSnapshot,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";

type FilesListApi = RendererPluginContext["files"]["list"];

function file(path: string): FileEntry {
  return { kind: "file", path, root: ROOT };
}

function directory(path: string): FileEntry {
  return { kind: "directory", path, root: ROOT };
}

function listFromResponses(
  responsesByPath: Readonly<Record<string, readonly FileEntry[]>>
): FilesListApi {
  return vi.fn<FilesListApi>((requestOrRoot, options) => {
    const path =
      typeof requestOrRoot === "string"
        ? (options?.path ?? "")
        : requestOrRoot.path;
    return Promise.resolve([...(responsesByPath[path] ?? [])]);
  });
}

describe("files-tree-search-loader", () => {
  afterEach(() => {
    clearFilesTreeStore();
    vi.restoreAllMocks();
  });

  it("loads every visible lazy directory before returning search results", async () => {
    const list = listFromResponses({
      "": [directory("assets"), directory("src"), file("README.md")],
      assets: [file("assets/reset.css"), file("assets/logo.svg")],
      src: [directory("src/styles"), file("src/app.tsx")],
      "src/styles": [file("src/styles/app.css"), file("src/styles/theme.CSS")],
    });

    const result = await loadFilesTreeForSearch(
      ROOT,
      list,
      "Failed to load files"
    );

    expect(result.failures).toEqual([]);
    expect(list).toHaveBeenCalledTimes(4);
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("assets/reset.css")).toEqual(
      file("assets/reset.css")
    );
    expect(snapshot.entriesByPath.get("src/styles/app.css")).toEqual(
      file("src/styles/app.css")
    );
    expect(snapshot.entriesByPath.get("src/styles/theme.CSS")).toEqual(
      file("src/styles/theme.CSS")
    );
    expect(snapshot.directoryStatesByPath.get("assets")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("src")).toBe("loaded");
    expect(snapshot.directoryStatesByPath.get("src/styles")).toBe("loaded");
  });

  it("shares one whole-tree traversal across concurrent search requests", async () => {
    const list = listFromResponses({
      "": [directory("src")],
      src: [file("src/app.css")],
    });

    const first = loadFilesTreeForSearch(ROOT, list, "Failed to load files");
    const second = loadFilesTreeForSearch(ROOT, list, "Failed to load files");

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ failures: [] });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("continues loading sibling directories and reports partial failures", async () => {
    const list = vi.fn<FilesListApi>((requestOrRoot, options) => {
      const path =
        typeof requestOrRoot === "string"
          ? (options?.path ?? "")
          : requestOrRoot.path;
      if (path === "src") {
        return Promise.reject(new Error("Permission denied"));
      }
      return Promise.resolve(
        path === ""
          ? [directory("assets"), directory("src")]
          : [file("assets/app.css")]
      );
    });

    const result = await loadFilesTreeForSearch(
      ROOT,
      list,
      "Failed to load files"
    );

    expect(result.failures).toEqual([
      { error: expect.any(Error), path: "src" },
    ]);
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("assets/app.css")).toBe(
      true
    );
    expect(getFilesTreeSnapshot(ROOT).directoryStatesByPath.get("src")).toBe(
      "error"
    );
  });

  it("processes a wide tree through the bounded discovery queue", async () => {
    const topLevelPaths = Array.from(
      { length: 24 },
      (_, index) => `package-${index}`
    );
    let activeDirectoryLoads = 0;
    let peakDirectoryLoads = 0;
    const callsByPath = new Map<string, number>();
    const list = vi.fn<FilesListApi>(async (_requestOrRoot, options) => {
      const path = options?.path ?? "";
      callsByPath.set(path, (callsByPath.get(path) ?? 0) + 1);
      if (path === "") {
        return topLevelPaths.map(directory);
      }
      activeDirectoryLoads += 1;
      peakDirectoryLoads = Math.max(peakDirectoryLoads, activeDirectoryLoads);
      await Promise.resolve();
      activeDirectoryLoads -= 1;
      const depth = path.split("/").length;
      return depth === 1
        ? [directory(`${path}/a`), directory(`${path}/b`)]
        : [file(`${path}/index.ts`)];
    });

    await expect(
      loadFilesTreeForSearch(ROOT, list, "Failed to load files")
    ).resolves.toEqual({ failures: [] });

    expect(peakDirectoryLoads).toBeLessThanOrEqual(8);
    expect(callsByPath.size).toBe(1 + 24 + 48);
    expect([...callsByPath.values()].every((count) => count === 1)).toBe(true);
  });
});
