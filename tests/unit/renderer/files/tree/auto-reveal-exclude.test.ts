import { isExcludedFileTreePath } from "@plugins/builtin/files/renderer/tree/visibility.ts";
import { FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS } from "@plugins/builtin/files/settings.ts";
import { describe, expect, it } from "vitest";

describe("autoRevealExclude defaults", () => {
  it("matches node_modules and bower_components paths", () => {
    const source = FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS;
    expect(isExcludedFileTreePath("node_modules/lodash/index.js", source)).toBe(
      true
    );
    expect(
      isExcludedFileTreePath("packages/ui/node_modules/x/index.js", source)
    ).toBe(true);
    expect(isExcludedFileTreePath("bower_components/pkg/a.js", source)).toBe(
      true
    );
  });

  it("does not match ordinary source paths", () => {
    const source = FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS;
    expect(isExcludedFileTreePath("src/app.tsx", source)).toBe(false);
    expect(
      isExcludedFileTreePath("packages/ui/src/file/tree.tsx", source)
    ).toBe(false);
  });
});
