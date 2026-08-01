import {
  collectKnownDirectoryPaths,
  resolveExpandedPaths,
  shouldSkipExpandDueToCollapse,
} from "@pier/ui/file/tree-expansion-apply.ts";
import {
  getTreeExpansionAuthority,
  resetTreeExpansionAuthoritiesForTests,
} from "@pier/ui/file/tree-expansion-authority.ts";
import type { PierFileTreeItem } from "@pier/ui/file/tree-types.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("TreeExpansionAuthority", () => {
  beforeEach(() => {
    resetTreeExpansionAuthoritiesForTests();
  });

  it("shares the same instance for a scope id", () => {
    const a = getTreeExpansionAuthority("files:/tmp/proj");
    const b = getTreeExpansionAuthority("files:/tmp/proj");
    expect(a).toBe(b);
  });

  it("setDirectoryExpanded is mutually exclusive", () => {
    const authority = getTreeExpansionAuthority("t1");
    authority.setDirectoryExpanded("src", true, "user");
    authority.setDirectoryExpanded("src", false, "user");
    const intent = authority.getIntent();
    expect(intent.expanded.has("src")).toBe(false);
    expect(intent.collapsed.has("src")).toBe(true);
  });

  it("api expand clears user-collapsed root (Expand Folders intent)", () => {
    // 右键 Expand Folders：必须 setDirectoryExpanded(root, true, "api") 清 collapsed
    const authority = getTreeExpansionAuthority("expand-folders-root");
    authority.setDirectoryExpanded("src", false, "user");
    authority.setDirectoryExpanded("docs", false, "user");
    authority.setDirectoryExpanded("src", true, "api");
    const intent = authority.getIntent();
    expect(intent.expanded.has("src")).toBe(true);
    expect(intent.collapsed.has("src")).toBe(false);
    // sibling 仍可保持 user-collapsed
    expect(intent.collapsed.has("docs")).toBe(true);
  });

  it("subtree Expand Folders re-opens descendants after Collapse Folders", () => {
    // Collapse Folders 会把 root+子孙全部 collapsed；Expand 必须强制整子树
    const authority = getTreeExpansionAuthority("collapse-then-expand");
    const group = "\u0001Changes";
    const paths = [group, `${group}/src`, `${group}/src/lib`, "\u0002Staged"];
    authority.collapseAll(paths, "api");
    // 模拟 Expand 子树：清 group 范围内全部 collapsed
    for (const path of paths) {
      if (path === group || path.startsWith(`${group}/`)) {
        authority.setDirectoryExpanded(path, true, "api");
      }
    }
    const intent = authority.getIntent();
    expect(intent.collapsed.has(group)).toBe(false);
    expect(intent.collapsed.has(`${group}/src`)).toBe(false);
    expect(intent.collapsed.has(`${group}/src/lib`)).toBe(false);
    expect(intent.expanded.has(`${group}/src/lib`)).toBe(true);
    // sibling group 仍 collapsed
    expect(intent.collapsed.has("\u0002Staged")).toBe(true);
  });

  it("collapseAll marks known directories collapsed", () => {
    const authority = getTreeExpansionAuthority("t2");
    authority.setDirectoryExpanded("src", true, "user");
    authority.setDirectoryExpanded("src/lib", true, "user");
    authority.collapseAll(["src", "src/lib", "app"], "api");
    const intent = authority.getIntent();
    expect(intent.expanded.size).toBe(0);
    expect(intent.collapsed.has("src")).toBe(true);
    expect(intent.collapsed.has("src/lib")).toBe(true);
    expect(intent.collapsed.has("app")).toBe(true);
  });

  it("remapPath rewrites expanded and collapsed keys", () => {
    const authority = getTreeExpansionAuthority("t3");
    authority.setDirectoryExpanded("src", true, "user");
    authority.setDirectoryExpanded("src/lib", true, "user");
    authority.setDirectoryExpanded("src/old", false, "user");
    authority.remapPath("src", "packages/src");
    const intent = authority.getIntent();
    expect(intent.expanded.has("packages/src")).toBe(true);
    expect(intent.expanded.has("packages/src/lib")).toBe(true);
    expect(intent.collapsed.has("packages/src/old")).toBe(true);
    expect(intent.expanded.has("src")).toBe(false);
  });

  it("pruneToKnown drops missing paths", () => {
    const authority = getTreeExpansionAuthority("t4");
    authority.setDirectoryExpanded("src", true, "user");
    authority.setDirectoryExpanded("gone", true, "user");
    authority.pruneToKnown(new Set(["src"]));
    const intent = authority.getIntent();
    expect(intent.expanded.has("src")).toBe(true);
    expect(intent.expanded.has("gone")).toBe(false);
  });

  it("reconcileKnownDirectories keeps never-known nested restore intents", () => {
    const authority = getTreeExpansionAuthority("t4b");
    // Simulate cold restore: nested expanded before root children are listed.
    expect(
      authority.loadJSON({
        collapsed: [],
        expanded: ["src", "src/lib", "src/lib/deep"],
        updatedAt: 1,
        v: 1,
      })
    ).toBe(true);
    // First paint only knows root-level dirs.
    authority.reconcileKnownDirectories(new Set(["src"]), new Set(["src"]));
    let intent = authority.getIntent();
    expect(intent.expanded.has("src")).toBe(true);
    expect(intent.expanded.has("src/lib")).toBe(true);
    expect(intent.expanded.has("src/lib/deep")).toBe(true);
    // After delete of src/lib from the store, only drop what was previously known.
    authority.reconcileKnownDirectories(
      new Set(["src", "src/lib"]),
      new Set(["src"])
    );
    intent = authority.getIntent();
    expect(intent.expanded.has("src")).toBe(true);
    expect(intent.expanded.has("src/lib")).toBe(false);
    // deep was never in previousKnown — still present until pruned explicitly.
    expect(intent.expanded.has("src/lib/deep")).toBe(true);
  });

  it("round-trips JSON restore", () => {
    const authority = getTreeExpansionAuthority("t5");
    authority.setDirectoryExpanded("src", true, "user");
    authority.setDirectoryExpanded("docs", false, "user");
    const json = authority.toJSON();
    resetTreeExpansionAuthoritiesForTests();
    const restored = getTreeExpansionAuthority("t5");
    expect(restored.loadJSON(json)).toBe(true);
    const intent = restored.getIntent();
    expect(intent.expanded.has("src")).toBe(true);
    expect(intent.collapsed.has("docs")).toBe(true);
  });
});

describe("shouldSkipExpandDueToCollapse", () => {
  it("subtree Expand does not skip collapsed descendants under root", () => {
    const group = "\u0001Changes";
    expect(
      shouldSkipExpandDueToCollapse({
        isUserCollapsed: true,
        path: `${group}/src/lib`,
        rootPath: group,
      })
    ).toBe(false);
    expect(
      shouldSkipExpandDueToCollapse({
        isUserCollapsed: true,
        path: group,
        rootPath: group,
      })
    ).toBe(false);
  });

  it("whole-tree Expand still skips user-collapsed dirs", () => {
    expect(
      shouldSkipExpandDueToCollapse({
        isUserCollapsed: true,
        path: "src",
        rootPath: "",
      })
    ).toBe(true);
  });

  it("does not force-open siblings outside expand root", () => {
    expect(
      shouldSkipExpandDueToCollapse({
        isUserCollapsed: true,
        path: "\u0002Staged/src",
        rootPath: "\u0001Changes",
      })
    ).toBe(true);
  });

  it("never skips when not user-collapsed", () => {
    expect(
      shouldSkipExpandDueToCollapse({
        isUserCollapsed: false,
        path: "src",
        rootPath: "",
      })
    ).toBe(false);
  });
});

describe("Expand All caps defaults", () => {
  it("exports safety defaults used by Expand All", async () => {
    const {
      EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS,
      EXPAND_ALL_DEFAULT_MAX_DEPTH,
      EXPAND_ALL_DEFAULT_MAX_DIRECTORY_EXPANDS,
      EXPAND_ALL_DEFAULT_MAX_EXPAND_LEVELS,
    } = await import("@pier/ui/file/tree-expansion-apply.ts");
    expect(EXPAND_ALL_DEFAULT_MAX_DIRECTORY_EXPANDS).toBe(2000);
    expect(EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS).toBe(8);
    expect(EXPAND_ALL_DEFAULT_MAX_DEPTH).toBe(64);
    expect(EXPAND_ALL_DEFAULT_MAX_EXPAND_LEVELS).toBe(3);
  });
});

describe("isPathUnderRoot / filterPathsUnderRoot", () => {
  it("scopes subtree paths under the right-clicked folder", async () => {
    const { filterPathsUnderRoot, isPathUnderRoot } = await import(
      "@pier/ui/file/tree-expansion-apply.ts"
    );
    expect(isPathUnderRoot(".husky", ".husky")).toBe(true);
    expect(isPathUnderRoot(".husky/pre-commit", ".husky")).toBe(true);
    expect(isPathUnderRoot("src", ".husky")).toBe(false);
    expect(isPathUnderRoot("src/lib", ".husky")).toBe(false);
    expect(
      filterPathsUnderRoot(
        [".husky", ".husky/pre-commit", "src", "src/lib"],
        ".husky"
      )
    ).toEqual([".husky", ".husky/pre-commit"]);
  });
});

describe("relativeExpandDepth", () => {
  it("counts levels from the expand root for maxExpandLevels", async () => {
    const { relativeExpandDepth } = await import(
      "@pier/ui/file/tree-expansion-apply.ts"
    );
    expect(relativeExpandDepth(".husky", ".husky")).toBe(0);
    expect(relativeExpandDepth(".husky/hooks", ".husky")).toBe(1);
    expect(relativeExpandDepth(".husky/hooks/x", ".husky")).toBe(2);
    // maxExpandLevels=3 → relativeDepth 0,1,2 allowed (depth < 3)
    expect(relativeExpandDepth("src/a/b", "")).toBe(3);
  });
});

describe("resolveExpandedPaths", () => {
  const items: PierFileTreeItem[] = [
    { kind: "directory", path: "src", hasChildren: true, loadState: "loaded" },
    {
      kind: "directory",
      path: "src/lib",
      hasChildren: true,
      loadState: "loaded",
    },
    { kind: "file", path: "src/lib/a.ts" },
    { kind: "directory", path: "docs", hasChildren: true, loadState: "loaded" },
  ];

  it("defaults to collapsed without intent or seed", () => {
    const paths = resolveExpandedPaths(
      items,
      { expanded: new Set(), collapsed: new Set() },
      { seed: "none" }
    );
    expect(paths).toEqual([]);
  });

  it("respects explicit expanded", () => {
    const paths = resolveExpandedPaths(
      items,
      { expanded: new Set(["src"]), collapsed: new Set() },
      { seed: "none", propagateCompactChains: false }
    );
    expect(paths).toContain("src");
    expect(paths).not.toContain("src/lib");
  });

  it("collapsed wins over expanded", () => {
    const paths = resolveExpandedPaths(
      items,
      { expanded: new Set(["src", "src/lib"]), collapsed: new Set(["src"]) },
      { seed: "none" }
    );
    expect(paths).not.toContain("src");
  });

  it("seeds file ancestors when no intent", () => {
    const paths = resolveExpandedPaths(
      items,
      { expanded: new Set(), collapsed: new Set() },
      { seed: "file-ancestors", propagateCompactChains: false }
    );
    expect(paths).toContain("src");
    expect(paths).toContain("src/lib");
    expect(paths).not.toContain("docs");
  });

  it("does not seed through a collapsed ancestor", () => {
    const paths = resolveExpandedPaths(
      items,
      { expanded: new Set(), collapsed: new Set(["src"]) },
      { seed: "file-ancestors", propagateCompactChains: false }
    );
    expect(paths).not.toContain("src");
    expect(paths).not.toContain("src/lib");
  });

  it("collectKnownDirectoryPaths includes ancestors", () => {
    const known = collectKnownDirectoryPaths(items);
    expect(known.has("src")).toBe(true);
    expect(known.has("src/lib")).toBe(true);
    expect(known.has("docs")).toBe(true);
  });

  it("propagates expand along single-child chains after lazy children arrive", () => {
    // User expanded only the chain head; after list, children appear — intent
    // must still open intermediate dirs so compact first-click shows content.
    const chainItems: PierFileTreeItem[] = [
      {
        kind: "directory",
        path: "pkg",
        hasChildren: true,
        loadState: "loaded",
      },
      {
        kind: "directory",
        path: "pkg/nested",
        hasChildren: true,
        loadState: "loaded",
      },
      {
        kind: "directory",
        path: "pkg/nested/deep",
        hasChildren: true,
        loadState: "loaded",
      },
      { kind: "file", path: "pkg/nested/deep/index.ts" },
    ];
    const paths = resolveExpandedPaths(
      chainItems,
      { expanded: new Set(["pkg"]), collapsed: new Set() },
      { seed: "none", propagateCompactChains: true }
    );
    expect(paths).toContain("pkg");
    expect(paths).toContain("pkg/nested");
    expect(paths).toContain("pkg/nested/deep");
  });

  it("does not re-open a user-collapsed compact-chain member", () => {
    const chainItems: PierFileTreeItem[] = [
      {
        kind: "directory",
        path: "pkg",
        hasChildren: true,
        loadState: "loaded",
      },
      {
        kind: "directory",
        path: "pkg/nested",
        hasChildren: true,
        loadState: "loaded",
      },
      { kind: "file", path: "pkg/nested/a.ts" },
    ];
    const paths = resolveExpandedPaths(
      chainItems,
      {
        expanded: new Set(["pkg"]),
        collapsed: new Set(["pkg/nested"]),
      },
      { seed: "none", propagateCompactChains: true }
    );
    expect(paths).toContain("pkg");
    expect(paths).not.toContain("pkg/nested");
  });
});

describe("whole-tree expand level cap parity", () => {
  it("allows top-level depth up to maxExpandLevels for empty root", async () => {
    const { pathSegmentDepth, relativeExpandDepth } = await import(
      "@pier/ui/file/tree-expansion-apply.ts"
    );
    const maxExpandLevels = 3;
    // Whole-tree: pathSegmentDepth <= maxExpandLevels
    expect(pathSegmentDepth("src") <= maxExpandLevels).toBe(true);
    expect(pathSegmentDepth("src/a") <= maxExpandLevels).toBe(true);
    expect(pathSegmentDepth("src/a/b") <= maxExpandLevels).toBe(true);
    expect(pathSegmentDepth("src/a/b/c") <= maxExpandLevels).toBe(false);
    // Subtree: relative depth < maxExpandLevels (0,1,2)
    expect(relativeExpandDepth("src", "src") < maxExpandLevels).toBe(true);
    expect(relativeExpandDepth("src/a", "src") < maxExpandLevels).toBe(true);
    expect(relativeExpandDepth("src/a/b", "src") < maxExpandLevels).toBe(true);
    expect(relativeExpandDepth("src/a/b/c", "src") < maxExpandLevels).toBe(
      false
    );
  });
});
