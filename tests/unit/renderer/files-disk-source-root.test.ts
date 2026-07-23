import { isDiskSourceRootAllowed } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { describe, expect, it } from "vitest";

describe("isDiskSourceRootAllowed", () => {
  it("allows exact project/git/worktree anchors", () => {
    expect(
      isDiskSourceRootAllowed("/repo/worktree", {
        contextId: "c",
        gitRoot: "/repo/worktree",
        projectRootPath: "/repo/worktree",
        updatedAt: 1,
      })
    ).toBe(true);
  });

  it("tolerates trailing slashes on either side", () => {
    expect(
      isDiskSourceRootAllowed("/repo/", {
        contextId: "c",
        projectRootPath: "/repo",
        updatedAt: 1,
      })
    ).toBe(true);
  });

  it("allows self-consistent source when panel context is missing (restore fail-open)", () => {
    expect(isDiskSourceRootAllowed("/repo", null)).toBe(true);
    expect(isDiskSourceRootAllowed("/repo", undefined)).toBe(true);
  });

  it("rejects a root that is not any workspace anchor", () => {
    expect(
      isDiskSourceRootAllowed("/other", {
        contextId: "c",
        projectRootPath: "/repo",
        updatedAt: 1,
      })
    ).toBe(false);
  });
});
