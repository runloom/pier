import { clearFileTreeSidebarCache } from "@plugins/builtin/files/renderer/files-tree-registry.ts";
import { revealFilesTreePathAfterAncestors } from "@plugins/builtin/files/renderer/files-tree-reveal.ts";
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

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("revealFilesTreePathAfterAncestors", () => {
  afterEach(() => {
    clearFilesTreeStore();
    clearFileTreeSidebarCache();
    vi.restoreAllMocks();
  });

  it("loads ancestor and target directories so folder reveal has real children", async () => {
    const list = vi.fn(async (_root: string, options?: { path?: string }) => {
      const path = options?.path ?? "";
      if (path === "") {
        return [directory("src")];
      }
      if (path === "src") {
        return [directory("src/preload"), file("src/main.ts")];
      }
      if (path === "src/preload") {
        return [file("src/preload/ai-api.ts")];
      }
      return [];
    });

    loadFilesTreeRoot(ROOT, list, "Failed to load files");
    await settle();

    revealFilesTreePathAfterAncestors({
      list,
      path: "src/preload",
      root: ROOT,
    });
    await settle();
    await settle();

    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.get("src/preload")).toEqual(
      directory("src/preload")
    );
    expect(snapshot.entriesByPath.get("src/preload/ai-api.ts")).toEqual(
      file("src/preload/ai-api.ts")
    );
    expect(snapshot.directoryStatesByPath.get("src/preload")).toBe("loaded");
    expect(list).toHaveBeenCalledWith(ROOT, { path: "src" });
    expect(list).toHaveBeenCalledWith(ROOT, { path: "src/preload" });
  });
});
