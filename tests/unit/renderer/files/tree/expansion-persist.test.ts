import {
  getTreeExpansionAuthority,
  resetTreeExpansionAuthoritiesForTests,
} from "@pier/ui/file/tree-expansion-authority.ts";
import {
  bindTreeExpansionPersistence,
  readTreeExpansion,
  writeTreeExpansion,
} from "@pier/ui/file/tree-expansion-persist.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
