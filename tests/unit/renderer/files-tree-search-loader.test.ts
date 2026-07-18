import { loadFilesTreeForSearch } from "@plugins/builtin/files/renderer/files-tree-search-loader.ts";
import { describe, expect, it } from "vitest";

describe("files-tree-search-loader", () => {
  it("rejects whole-tree search loads (path query replaced this path)", async () => {
    await expect(
      loadFilesTreeForSearch("/repo", {} as never, "Failed to load files")
    ).rejects.toThrow(/removed|path query/i);
  });
});
