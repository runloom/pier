import {
  planPendingReveal,
  resolvePendingRevealTarget,
} from "@plugins/builtin/git/renderer/hooks/pending-reveal-plan.ts";
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

  it("prefers preferred group then unstaged when fallback is allowed", () => {
    const e = entry("a.ts", ["unstaged", "staged"]);
    expect(
      resolvePendingRevealTarget(e, {
        allowGroupFallback: true,
        group: "staged",
        line: 10,
        nonce: 3,
        path: "a.ts",
        side: "new",
      })?.group
    ).toBe("staged");
    expect(
      resolvePendingRevealTarget(e, {
        allowGroupFallback: true,
        line: 10,
        nonce: 4,
        path: "a.ts",
        side: "new",
      })?.group
    ).toBe("unstaged");
  });
});

describe("planPendingReveal", () => {
  const pending = {
    allowGroupFallback: true as const,
    group: "unstaged" as const,
    line: 5,
    nonce: 9,
    path: "a.ts",
    side: "new" as const,
  };

  it("opens when path and group resolve", () => {
    expect(
      planPendingReveal(pending, [entry("a.ts", ["unstaged"])], false)
    ).toEqual({
      entryKey: "entry:a.ts",
      group: "unstaged",
      kind: "open",
      line: 5,
      sectionKey: "section:a.ts:unstaged",
      side: "new",
    });
  });

  it("waits when path is missing while index is refreshing", () => {
    expect(
      planPendingReveal(pending, [entry("other.ts", ["unstaged"])], true)
    ).toEqual({
      kind: "wait",
    });
  });

  it("consumes when path is missing and index is stable", () => {
    expect(
      planPendingReveal(pending, [entry("other.ts", ["unstaged"])], false)
    ).toEqual({
      kind: "consume",
    });
  });

  it("waits when preferred group is missing during refresh", () => {
    expect(
      planPendingReveal(
        { ...pending, allowGroupFallback: false, group: "staged" },
        [entry("a.ts", ["unstaged"])],
        true
      )
    ).toEqual({ kind: "wait" });
  });

  it("falls back to staged when allowGroupFallback and preferred unstaged is gone", () => {
    const plan = planPendingReveal(pending, [entry("a.ts", ["staged"])], false);
    expect(plan).toMatchObject({ kind: "open", group: "staged" });
  });
});
