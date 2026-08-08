import { resolvePendingRevealTarget } from "@plugins/builtin/git/renderer/hooks/use-review-comments-binding.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";

function entry(
  path: string,
  groups: readonly ("unstaged" | "staged" | "conflict" | "committed")[]
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: groups.map((group) => ({
      additions: 1,
      binary: false,
      deletions: 0,
      group,
      oldPath: null,
      sectionKey: `section:${path}:${group}`,
      status: "modified" as const,
      targetPath: path,
    })),
    status: "modified",
  };
}

describe("resolvePendingRevealTarget", () => {
  it("uses exact group for comment reveals (no fallback)", () => {
    const e = entry("a.ts", ["unstaged", "staged"]);
    expect(
      resolvePendingRevealTarget(e, {
        group: "staged",
        line: 3,
        nonce: 1,
        path: "a.ts",
        side: "new",
      })
    ).toEqual({ group: "staged", sectionKey: "section:a.ts:staged" });
  });

  it("does not fall back when preferred comment group has no section", () => {
    const e = entry("a.ts", ["unstaged"]);
    expect(
      resolvePendingRevealTarget(e, {
        group: "staged",
        line: 3,
        nonce: 1,
        path: "a.ts",
        side: "new",
      })
    ).toBeNull();
  });

  it("falls back for gutter when only staged slot exists", () => {
    const e = entry("a.ts", ["staged"]);
    expect(
      resolvePendingRevealTarget(e, {
        allowGroupFallback: true,
        line: 10,
        nonce: 2,
        path: "a.ts",
        side: "new",
      })
    ).toEqual({ group: "staged", sectionKey: "section:a.ts:staged" });
  });

  it("prefers unstaged when both slots exist and fallback is allowed", () => {
    const e = entry("a.ts", ["unstaged", "staged"]);
    expect(
      resolvePendingRevealTarget(e, {
        allowGroupFallback: true,
        line: 10,
        nonce: 3,
        path: "a.ts",
        side: "new",
      })?.group
    ).toBe("unstaged");
  });
});
