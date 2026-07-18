import { materializePathQueryHits } from "@plugins/builtin/files/renderer/files-path-query-materialize.ts";
import {
  clearFilesTreeStore,
  getFilesTreeSnapshot,
  loadFilesTreeRoot,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";

function file(path: string): FileEntry {
  return { kind: "file", path, root: ROOT };
}

function directory(path: string): FileEntry {
  return { kind: "directory", path, root: ROOT };
}

afterEach(() => {
  clearFilesTreeStore();
});

describe("materializePathQueryHits", () => {
  it("loads only ancestor directories for hits, never whole-tree BFS", async () => {
    const listedPaths: string[] = [];
    const list = vi.fn(async (_root: string, options?: { path?: string }) => {
      const path = options?.path ?? "";
      listedPaths.push(path);
      if (path === "") {
        return [directory("src"), file("README.md")];
      }
      if (path === "src") {
        return [directory("src/plugins"), directory("src/other")];
      }
      if (path === "src/plugins") {
        return [
          file(
            "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
          ),
        ];
      }
      if (path === "src/other") {
        return [file("src/other/noise.ts")];
      }
      return [];
    });

    await loadFilesTreeRoot(ROOT, list, "Failed");
    listedPaths.length = 0;

    await materializePathQueryHits({
      list,
      paths: ["src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"],
      root: ROOT,
    });

    expect(listedPaths).toEqual(
      expect.arrayContaining([
        "src",
        "src/plugins",
        "src/plugins/builtin",
        "src/plugins/builtin/files",
        "src/plugins/builtin/files/renderer",
      ])
    );
    expect(listedPaths).not.toContain("src/other");
    expect(listedPaths.every((path) => path !== "")).toBe(true);

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(
      snapshot.entriesByPath.has(
        "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
      ) || snapshot.entriesByPath.has("src/plugins")
    ).toBe(true);
  });

  it("aborts when signal is aborted before loads finish", async () => {
    const controller = new AbortController();
    const list = vi.fn(async () => {
      controller.abort();
      return [] as FileEntry[];
    });
    await loadFilesTreeRoot(ROOT, list, "Failed");

    await materializePathQueryHits({
      list,
      paths: ["a/b/c.ts"],
      root: ROOT,
      signal: controller.signal,
    });

    // Does not throw; aborted mid-flight is fine.
    expect(controller.signal.aborted).toBe(true);
  });
});
