import {
  getTreeExpansionAuthority,
  resetTreeExpansionAuthoritiesForTests,
} from "@pier/ui/file/tree-expansion-authority.ts";
import {
  bindTreeExpansionPersistence,
  hydrateTreeExpansion,
  readTreeExpansion,
  writeTreeExpansion,
} from "@pier/ui/file/tree-expansion-persist.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectFilesTreeRestoreDirectoryPaths,
  hydrateFilesTreeExpansion,
  readFilesTreeExpandedPaths,
} from "../../../../../src/plugins/builtin/files/renderer/tree/expansion-persist.ts";

const KEY = "pier.test.tree.expansion.v1:scope";

describe("tree expansion persistence", () => {
  beforeEach(() => {
    resetTreeExpansionAuthoritiesForTests();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("restores a persisted intent when binding", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        collapsed: ["docs"],
        expanded: ["src", "src/lib"],
        updatedAt: 1,
        v: 1,
      })
    );
    const authority = getTreeExpansionAuthority("restore-scope");

    const unbind = bindTreeExpansionPersistence(KEY, authority);

    const intent = authority.getIntent();
    expect([...intent.expanded].sort()).toEqual(["src", "src/lib"]);
    expect([...intent.collapsed]).toEqual(["docs"]);
    unbind();
  });

  it("debounces writes and flushes the pending one on unbind", () => {
    const authority = getTreeExpansionAuthority("write-scope");
    const unbind = bindTreeExpansionPersistence(KEY, authority);

    authority.setDirectoryExpanded("src", true, "user");
    expect(localStorage.getItem(KEY)).toBeNull();

    vi.advanceTimersByTime(300);
    expect(readTreeExpansion(KEY)).toMatchObject({ expanded: ["src"], v: 1 });

    authority.setDirectoryExpanded("docs", false, "user");
    unbind();
    expect(readTreeExpansion(KEY)).toMatchObject({ collapsed: ["docs"] });
  });

  it("stops writing after unbind", () => {
    const authority = getTreeExpansionAuthority("detach-scope");
    bindTreeExpansionPersistence(KEY, authority)();
    localStorage.removeItem(KEY);

    authority.setDirectoryExpanded("late", true, "user");
    vi.advanceTimersByTime(1000);

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("hydrates once so a later bind cannot clobber in-session collapse", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        collapsed: [],
        expanded: ["src"],
        updatedAt: 1,
        v: 1,
      })
    );
    const authority = getTreeExpansionAuthority("hydrate-once-scope");
    expect(hydrateTreeExpansion(KEY, authority)).toBe(true);
    expect([...authority.getIntent().expanded]).toEqual(["src"]);

    authority.setDirectoryExpanded("src", false, "user");
    expect(hydrateTreeExpansion(KEY, authority)).toBe(false);
    expect([...authority.getIntent().collapsed]).toEqual(["src"]);
    expect(authority.getIntent().expanded.size).toBe(0);

    bindTreeExpansionPersistence(KEY, authority)();
    expect([...authority.getIntent().collapsed]).toEqual(["src"]);
  });

  it("can hydrate a second storage key on the same authority", () => {
    const authority = getTreeExpansionAuthority("two-key-scope");
    const secondKey = `${KEY}:other`;
    expect(hydrateTreeExpansion(KEY, authority)).toBe(false);
    localStorage.setItem(
      secondKey,
      JSON.stringify({
        collapsed: [],
        expanded: ["docs"],
        updatedAt: 1,
        v: 1,
      })
    );
    expect(hydrateTreeExpansion(secondKey, authority)).toBe(true);
    expect([...authority.getIntent().expanded]).toEqual(["docs"]);
  });

  it("reads files expanded paths shallow-first from the files key space", () => {
    localStorage.setItem(
      "pier.files.tree.expansion.v1:/repo",
      JSON.stringify({
        collapsed: [],
        expanded: ["src/lib", "src", "docs"],
        updatedAt: 1,
        v: 1,
      })
    );
    expect(readFilesTreeExpandedPaths("/repo")).toEqual([
      "docs",
      "src",
      "src/lib",
    ]);
    const authority = getTreeExpansionAuthority("files:/repo");
    expect(hydrateFilesTreeExpansion("/repo", authority)).toBe(true);
    expect([...authority.getIntent().expanded].sort()).toEqual([
      "docs",
      "src",
      "src/lib",
    ]);
  });

  it("collects restore paths with ancestor closure minus collapsed and missing roots", () => {
    localStorage.setItem(
      "pier.files.tree.expansion.v1:/repo",
      JSON.stringify({
        collapsed: ["docs"],
        expanded: ["src/lib/util", "docs", "gone/nested"],
        updatedAt: 1,
        v: 1,
      })
    );
    expect(
      collectFilesTreeRestoreDirectoryPaths("/repo", {
        hasRootLevelDirectory: (name) => name === "src" || name === "docs",
        isVisible: () => true,
      })
    ).toEqual(["src", "src/lib", "src/lib/util"]);
  });

  it("omits restore paths hidden by visibility", () => {
    localStorage.setItem(
      "pier.files.tree.expansion.v1:/repo",
      JSON.stringify({
        collapsed: [],
        expanded: ["src", "src/secret"],
        updatedAt: 1,
        v: 1,
      })
    );
    expect(
      collectFilesTreeRestoreDirectoryPaths("/repo", {
        hasRootLevelDirectory: (name) => name === "src",
        isVisible: (path) => path !== "src/secret",
      })
    ).toEqual(["src"]);
  });

  it("stops restore closure when an ancestor is not visible", () => {
    localStorage.setItem(
      "pier.files.tree.expansion.v1:/repo",
      JSON.stringify({
        collapsed: [],
        expanded: ["src/lib"],
        updatedAt: 1,
        v: 1,
      })
    );
    expect(
      collectFilesTreeRestoreDirectoryPaths("/repo", {
        hasRootLevelDirectory: (name) => name === "src",
        isVisible: (path) => path !== "src",
      })
    ).toEqual([]);
  });

  it("treats a corrupt payload as no preference", () => {
    localStorage.setItem(KEY, "{not json");
    const authority = getTreeExpansionAuthority("corrupt-scope");

    expect(() => bindTreeExpansionPersistence(KEY, authority)()).not.toThrow();
    expect(authority.getIntent().expanded.size).toBe(0);
  });

  it("keeps paths closest to the root when over the cap", () => {
    const authority = getTreeExpansionAuthority("cap-scope");
    authority.expandPaths(["deep/a/b/c", "top", "mid/a"], "user");

    writeTreeExpansion(KEY, authority, 2);

    expect(readTreeExpansion(KEY)).toMatchObject({
      expanded: ["top", "mid/a"],
    });
  });

  it("never throws when storage rejects the write", () => {
    const authority = getTreeExpansionAuthority("quota-scope");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => writeTreeExpansion(KEY, authority)).not.toThrow();
  });
});
