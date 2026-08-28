import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILES_RENDERER_ROOT = join(
  process.cwd(),
  "src/plugins/builtin/files/renderer"
);

const COMMAND_PALETTE_SURFACE_RE =
  /surfaces:\s*\[[^\]]*"command-palette"[^\]]*\]/;

describe("files command-palette surface policy", () => {
  it("registers open-directory next to quick-open for the palette", () => {
    const openDirectory = readFileSync(
      join(FILES_RENDERER_ROOT, "project/open-directory-action.ts"),
      "utf8"
    );
    const quickOpen = readFileSync(
      join(FILES_RENDERER_ROOT, "search/quick-open.ts"),
      "utf8"
    );
    const index = readFileSync(join(FILES_RENDERER_ROOT, "index.tsx"), "utf8");

    expect(openDirectory).toMatch(COMMAND_PALETTE_SURFACE_RE);
    expect(openDirectory).toContain("FILES_OPEN_DIRECTORY_COMMAND_ID");
    expect(quickOpen).toMatch(COMMAND_PALETTE_SURFACE_RE);
    expect(quickOpen).toContain("FILES_QUICK_OPEN_COMMAND_ID");
    expect(index).toContain("createFilesOpenDirectoryAction");
    expect(index).toContain("createFilesQuickOpenAction");
  });

  it("registers search-in-files for the palette", () => {
    const searchActions = readFileSync(
      join(FILES_RENDERER_ROOT, "search/actions.ts"),
      "utf8"
    );
    expect(searchActions).toMatch(
      /id: FILES_SEARCH_CONTENTS_COMMAND_ID[\s\S]*?surfaces: \["command-palette"\]/
    );
    expect(searchActions).toMatch(
      /id: FILES_SEARCH_IN_FOLDER_COMMAND_ID[\s\S]*?surfaces: \["files\/tree-item", "files\/tree-background"\]/
    );
  });

  it("keeps save / tree-create off the command palette", () => {
    for (const fileName of [
      "save/all-action.ts",
      "tree/actions.ts",
      "tree/view-actions.ts",
    ] as const) {
      const source = readFileSync(join(FILES_RENDERER_ROOT, fileName), "utf8");
      expect(source).not.toMatch(COMMAND_PALETTE_SURFACE_RE);
    }
    const index = readFileSync(join(FILES_RENDERER_ROOT, "index.tsx"), "utf8");
    expect(index).toMatch(/id: FILES_SAVE_COMMAND_ID[\s\S]*?surfaces: \[\]/);
    expect(index).toMatch(/id: FILES_SAVE_AS_COMMAND_ID[\s\S]*?surfaces: \[\]/);
    const treeViewActions = readFileSync(
      join(FILES_RENDERER_ROOT, "tree/view-actions.ts"),
      "utf8"
    );
    expect(treeViewActions).toMatch(
      /id: FILES_TREE_SEARCH_COMMAND_ID[\s\S]*?surfaces: \[\]/
    );
    expect(treeViewActions).toMatch(
      /id: FILES_TREE_TOGGLE_COMMAND_ID[\s\S]*?surfaces: \[\]/
    );
  });
});
