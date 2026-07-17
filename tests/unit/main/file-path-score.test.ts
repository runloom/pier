import { describe, expect, it } from "vitest";
import {
  normalizeFilePathQuery,
  selectTopFilePaths,
} from "../../../src/main/services/file-query/path-score.ts";

describe("selectTopFilePaths", () => {
  const paths = [
    "src/main/ipc/theme.ts",
    "src/renderer/components/workspace/workspace-theme.ts",
    "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
    "packages/ui/src/file-icon-theme.ts",
    "README.md",
  ];

  it("normalizes query", () => {
    expect(normalizeFilePathQuery("  Theme.TS\\x  ")).toBe("theme.ts/x");
  });

  it("matches theme.ts inside code-mirror-editor-theme.ts", () => {
    const top = selectTopFilePaths(paths, "theme.ts", [], 200);
    expect(top.map((x) => x.path)).toContain(
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
    );
  });

  it("prefers basename hits and MRU", () => {
    const top = selectTopFilePaths(
      paths,
      "theme.ts",
      ["src/main/ipc/theme.ts"],
      3
    );
    expect(top[0]?.path).toBe("src/main/ipc/theme.ts");
  });

  it("returns empty-query shallow/MRU ordering without dumping everything unbounded", () => {
    const top = selectTopFilePaths(
      paths,
      "",
      ["packages/ui/src/file-icon-theme.ts"],
      2
    );
    expect(top).toHaveLength(2);
    expect(top[0]?.path).toBe("packages/ui/src/file-icon-theme.ts");
  });
});
