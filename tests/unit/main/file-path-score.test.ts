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
    // basename-only competitor that would win without MRU on a deeper basename path
    const ranked = selectTopFilePaths(
      [
        "deeply/nested/path/to/theme.ts",
        "src/main/ipc/theme.ts",
        "other/theme.ts-utils/readme.md",
      ],
      "theme.ts",
      ["src/main/ipc/theme.ts"],
      2
    );
    expect(ranked[0]?.path).toBe("src/main/ipc/theme.ts");
  });

  it("does not bake walk input index into the returned score", () => {
    // Late basename hit must still beat early path-only hit on large indices.
    const many = Array.from(
      { length: 1200 },
      (_, i) => `packages/pkg-${i}/theme.ts-utils/lib/index.js`
    );
    many.push("src/theme.ts");
    const top = selectTopFilePaths(many, "theme.ts", [], 5);
    expect(top[0]?.path).toBe("src/theme.ts");
    // Pure score: basename (+1000) + shallow depth, not reduced by input index.
    expect(top[0]?.score).toBeGreaterThan(900);
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
