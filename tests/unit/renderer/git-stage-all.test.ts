import {
  collectStageAllPaths,
  collectUnstageAllPaths,
} from "@plugins/builtin/git/renderer/git-stage-all.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { describe, expect, it } from "vitest";

function entry(partial: {
  path: string;
  entryKey?: string;
  slots: Array<{
    group: "unstaged" | "staged" | "conflict" | "committed";
    sectionKey: string;
    status?: "modified" | "added" | "conflicted" | "deleted" | "renamed";
    targetPath?: string;
  }>;
}): GitReviewIndexEntry {
  const status =
    partial.slots.find((slot) => slot.status === "conflicted")?.status ??
    partial.slots[0]?.status ??
    "modified";
  return {
    entryKey: partial.entryKey ?? `ek:${partial.path}`,
    oldPaths: [],
    path: partial.path,
    status,
    renderSlots: partial.slots.map((slot) => ({
      group: slot.group,
      oldPath: null,
      sectionKey: slot.sectionKey,
      status:
        slot.status ?? (slot.group === "conflict" ? "conflicted" : "modified"),
      targetPath: slot.targetPath ?? partial.path,
    })),
  };
}

describe("collectStageAllPaths", () => {
  it("stage all includes untracked and skips conflict paths", () => {
    const { paths, skippedConflicts } = collectStageAllPaths([
      entry({
        path: "a.ts",
        slots: [{ group: "unstaged", sectionKey: "sec:u:a" }],
      }),
      entry({
        path: "new.ts",
        slots: [
          { group: "unstaged", sectionKey: "sec:u:new", status: "added" },
        ],
      }),
      entry({
        path: "conflict.ts",
        slots: [
          {
            group: "conflict",
            sectionKey: "sec:c:conflict",
            status: "conflicted",
          },
        ],
      }),
      entry({
        path: "staged-only.ts",
        slots: [{ group: "staged", sectionKey: "sec:s:only" }],
      }),
    ]);
    expect(paths.sort()).toEqual(["a.ts", "new.ts"]);
    expect(skippedConflicts).toBe(1);
  });

  it("dedupes unstaged target paths and counts unique conflict skips", () => {
    const { paths, skippedConflicts } = collectStageAllPaths([
      entry({
        path: "shared.ts",
        slots: [
          { group: "unstaged", sectionKey: "sec:u:shared" },
          { group: "staged", sectionKey: "sec:s:shared" },
        ],
      }),
      entry({
        path: "c1.ts",
        slots: [
          {
            group: "conflict",
            sectionKey: "sec:c:1",
            status: "conflicted",
          },
        ],
      }),
      entry({
        path: "c2.ts",
        slots: [
          {
            group: "conflict",
            sectionKey: "sec:c:2",
            status: "conflicted",
          },
        ],
      }),
    ]);
    expect(paths).toEqual(["shared.ts"]);
    expect(skippedConflicts).toBe(2);
  });

  it("returns empty when only staged or committed slots exist", () => {
    const result = collectStageAllPaths([
      entry({
        path: "s.ts",
        slots: [{ group: "staged", sectionKey: "sec:s" }],
      }),
      entry({
        path: "done.ts",
        slots: [{ group: "committed", sectionKey: "sec:commit" }],
      }),
    ]);
    expect(result).toEqual({ paths: [], skippedConflicts: 0 });
  });
});

describe("collectUnstageAllPaths", () => {
  it("unstage all lists staged paths only", () => {
    const paths = collectUnstageAllPaths([
      entry({
        path: "a.ts",
        slots: [
          { group: "unstaged", sectionKey: "sec:u:a" },
          { group: "staged", sectionKey: "sec:s:a" },
        ],
      }),
      entry({
        path: "new.ts",
        slots: [
          { group: "unstaged", sectionKey: "sec:u:new", status: "added" },
        ],
      }),
      entry({
        path: "staged-only.ts",
        slots: [{ group: "staged", sectionKey: "sec:s:only" }],
      }),
      entry({
        path: "conflict.ts",
        slots: [
          {
            group: "conflict",
            sectionKey: "sec:c",
            status: "conflicted",
          },
        ],
      }),
    ]);
    expect(paths.sort()).toEqual(["a.ts", "staged-only.ts"]);
  });

  it("dedupes staged target paths", () => {
    const paths = collectUnstageAllPaths([
      entry({
        path: "a.ts",
        slots: [{ group: "staged", sectionKey: "sec:s:a" }],
      }),
      entry({
        path: "b.ts",
        entryKey: "ek:b-alias",
        slots: [
          {
            group: "staged",
            sectionKey: "sec:s:b",
            targetPath: "a.ts",
          },
        ],
      }),
    ]);
    expect(paths).toEqual(["a.ts"]);
  });
});
