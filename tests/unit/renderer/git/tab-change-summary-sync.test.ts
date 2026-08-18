import {
  planTabChangeSummaryWrite,
  sameTabChangeSummary,
  stripTabChangeSummaryFromParams,
  tabWorkingTreeStateForTarget,
} from "@plugins/builtin/git/renderer/tab-change-summary-sync.ts";
import { describe, expect, it } from "vitest";

const lineDelta = {
  changedFiles: 2,
  deletions: 3,
  excludedFiles: 0,
  insertions: 12,
  kind: "lineDelta" as const,
};

const stagedOverlap = {
  changedFiles: 1,
  deletions: 1,
  excludedFiles: 0,
  insertions: 2,
  kind: "lineDelta" as const,
};

const unstagedOverlap = {
  changedFiles: 1,
  deletions: 2,
  excludedFiles: 0,
  insertions: 10,
  kind: "lineDelta" as const,
};

const loadingIndex = { kind: "loading" as const };
const uncommitted = { target: { kind: "uncommitted" as const } };

describe("sameTabChangeSummary", () => {
  it("treats null and undefined current as equal to clear", () => {
    expect(sameTabChangeSummary(undefined, null)).toBe(true);
    expect(sameTabChangeSummary(null, null)).toBe(true);
    expect(sameTabChangeSummary(lineDelta, null)).toBe(false);
  });

  it("compares lineDelta fields structurally", () => {
    expect(sameTabChangeSummary({ ...lineDelta }, lineDelta)).toBe(true);
    expect(
      sameTabChangeSummary({ ...lineDelta, insertions: 1 }, lineDelta)
    ).toBe(false);
  });

  it("compares filesOnly reasons in order", () => {
    const filesOnly = {
      changedFiles: 2,
      kind: "filesOnly" as const,
      omittedFiles: 2,
      reasons: ["tooLarge" as const, "timeout" as const],
    };
    expect(sameTabChangeSummary({ ...filesOnly }, filesOnly)).toBe(true);
    expect(
      sameTabChangeSummary(
        { ...filesOnly, reasons: ["timeout", "tooLarge"] },
        filesOnly
      )
    ).toBe(false);
  });
});

describe("planTabChangeSummaryWrite", () => {
  it("clears when source is missing", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: loadingIndex,
      lastSourceKey: "a",
      source: null,
      sourceKey: null,
      workingTreeState: { kind: "idle" },
    });
    expect(result.nextLastSourceKey).toBeNull();
    expect(result.plan).toEqual({ action: "write", summary: null });
  });

  it("retains uncommitted summary while working-tree status is loading", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: loadingIndex,
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loading" },
    });
    expect(result.plan).toEqual({ action: "noop" });
    expect(result.nextLastSourceKey).toBe("scope-a");
  });

  it("clears when sourceKey changes under working-tree loading", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: loadingIndex,
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-b",
      workingTreeState: { kind: "loading" },
    });
    expect(result.plan).toEqual({ action: "write", summary: null });
    expect(result.nextLastSourceKey).toBe("scope-b");
  });

  it("writes working-tree HEAD net for uncommitted, ignoring staged+unstaged sum", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      indexState: {
        kind: "loaded",
        result: {
          groupSummaries: {
            staged: stagedOverlap,
            unstaged: unstagedOverlap,
          },
        },
      },
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loaded", summary: lineDelta },
    });
    expect(result.plan).toEqual({
      action: "write",
      summary: lineDelta,
    });
  });

  it("writes working-tree summary while review index is still loading", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      indexState: loadingIndex,
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loaded", summary: lineDelta },
    });
    expect(result.plan).toEqual({ action: "write", summary: lineDelta });
  });

  it("keeps working-tree summary when review index errors", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: { kind: "error" },
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loaded", summary: lineDelta },
    });
    expect(result.plan).toEqual({ action: "noop" });
  });

  it("no-ops when working-tree summary matches current param", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: {
        kind: "loaded",
        result: {
          groupSummaries: {
            unstaged: unstagedOverlap,
          },
        },
      },
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loaded", summary: lineDelta },
    });
    expect(result.plan).toEqual({ action: "noop" });
  });

  it("clears uncommitted trailing when working-tree status errors", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: {
        kind: "loaded",
        result: {
          groupSummaries: {
            staged: stagedOverlap,
            unstaged: unstagedOverlap,
          },
        },
      },
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "error" },
    });
    expect(result.plan).toEqual({ action: "write", summary: null });
  });

  it("writes committed group summary for commit target", () => {
    const committed = {
      changedFiles: 1,
      deletions: 2,
      excludedFiles: 0,
      insertions: 5,
      kind: "lineDelta" as const,
    };
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      indexState: {
        kind: "loaded",
        result: { groupSummaries: { committed } },
      },
      lastSourceKey: "scope-a",
      source: {
        target: {
          kind: "commit",
          oid: "abcdef0123456789abcdef0123456789abcdef01",
        },
      },
      sourceKey: "scope-a",
      workingTreeState: { kind: "idle" },
    });
    expect(result.plan).toEqual({ action: "write", summary: committed });
  });

  it("writes committed group summary for branch target", () => {
    const committed = {
      changedFiles: 4,
      deletions: 1,
      excludedFiles: 0,
      insertions: 6,
      kind: "lineDelta" as const,
    };
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      indexState: {
        kind: "loaded",
        result: { groupSummaries: { committed } },
      },
      lastSourceKey: "scope-a",
      source: { target: { kind: "branch", ref: "refs/heads/main" } },
      sourceKey: "scope-a",
      workingTreeState: { kind: "idle" },
    });
    expect(result.plan).toEqual({ action: "write", summary: committed });
  });

  it("writes filesOnly working-tree summary through for uncommitted", () => {
    const filesOnly = {
      changedFiles: 2,
      kind: "filesOnly" as const,
      omittedFiles: 2,
      reasons: ["tooLarge" as const],
    };
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      indexState: loadingIndex,
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "loaded", summary: filesOnly },
    });
    expect(result.plan).toEqual({ action: "write", summary: filesOnly });
  });

  it("treats uncommitted idle working-tree as pending", () => {
    const retain = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: loadingIndex,
      lastSourceKey: "scope-a",
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "idle" },
    });
    expect(retain.plan).toEqual({ action: "noop" });

    const clear = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      indexState: loadingIndex,
      lastSourceKey: null,
      source: uncommitted,
      sourceKey: "scope-a",
      workingTreeState: { kind: "idle" },
    });
    expect(clear.plan).toEqual({ action: "write", summary: null });
  });
});

describe("tabWorkingTreeStateForTarget", () => {
  it("is idle unless the review target is uncommitted", () => {
    expect(
      tabWorkingTreeStateForTarget(
        { kind: "commit", oid: "a".repeat(40) },
        { kind: "loaded", status: { changeSummary: lineDelta } }
      )
    ).toEqual({ kind: "idle" });
  });

  it("mirrors git status for uncommitted", () => {
    expect(
      tabWorkingTreeStateForTarget({ kind: "uncommitted" }, { kind: "loading" })
    ).toEqual({ kind: "loading" });
    expect(
      tabWorkingTreeStateForTarget({ kind: "uncommitted" }, { kind: "error" })
    ).toEqual({ kind: "error" });
    expect(
      tabWorkingTreeStateForTarget(
        { kind: "uncommitted" },
        { kind: "loaded", status: { changeSummary: lineDelta } }
      )
    ).toEqual({ kind: "loaded", summary: lineDelta });
  });
});

describe("stripTabChangeSummaryFromParams", () => {
  it("removes the ephemeral key only", () => {
    expect(
      stripTabChangeSummaryFromParams({
        source: { kind: "uncommitted" },
        tabChangeSummary: lineDelta,
      })
    ).toEqual({ source: { kind: "uncommitted" } });
    expect(stripTabChangeSummaryFromParams({ source: 1 })).toEqual({
      source: 1,
    });
  });
});
