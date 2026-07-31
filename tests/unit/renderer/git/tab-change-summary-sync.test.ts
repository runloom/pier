import {
  planTabChangeSummaryWrite,
  sameTabChangeSummary,
  stripTabChangeSummaryFromParams,
} from "@plugins/builtin/git/renderer/tab-change-summary-sync.ts";
import { describe, expect, it } from "vitest";

const lineDelta = {
  changedFiles: 2,
  deletions: 3,
  excludedFiles: 0,
  insertions: 12,
  kind: "lineDelta" as const,
};

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
      lastSourceKey: "a",
      source: null,
      sourceKey: null,
      state: { kind: "loading" },
    });
    expect(result.nextLastSourceKey).toBeNull();
    expect(result.plan).toEqual({ action: "write", summary: null });
  });

  it("retains summary across same-sourceKey loading", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      lastSourceKey: "scope-a",
      source: { target: { kind: "uncommitted" } },
      sourceKey: "scope-a",
      state: { kind: "loading" },
    });
    expect(result.plan).toEqual({ action: "noop" });
    expect(result.nextLastSourceKey).toBe("scope-a");
  });

  it("clears when sourceKey changes under loading", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      lastSourceKey: "scope-a",
      source: { target: { kind: "uncommitted" } },
      sourceKey: "scope-b",
      state: { kind: "loading" },
    });
    expect(result.plan).toEqual({ action: "write", summary: null });
    expect(result.nextLastSourceKey).toBe("scope-b");
  });

  it("writes merged lineDelta when loaded", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: null,
      lastSourceKey: "scope-a",
      source: { target: { kind: "uncommitted" } },
      sourceKey: "scope-a",
      state: {
        kind: "loaded",
        result: {
          groupSummaries: {
            staged: {
              changedFiles: 1,
              deletions: 1,
              excludedFiles: 0,
              insertions: 2,
              kind: "lineDelta",
            },
            unstaged: {
              changedFiles: 1,
              deletions: 2,
              excludedFiles: 0,
              insertions: 10,
              kind: "lineDelta",
            },
          },
        },
      },
    });
    expect(result.plan).toEqual({
      action: "write",
      summary: {
        changedFiles: 2,
        deletions: 3,
        excludedFiles: 0,
        insertions: 12,
        kind: "lineDelta",
      },
    });
  });

  it("no-ops when loaded summary matches current param", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      lastSourceKey: "scope-a",
      source: { target: { kind: "uncommitted" } },
      sourceKey: "scope-a",
      state: {
        kind: "loaded",
        result: {
          groupSummaries: {
            unstaged: lineDelta,
          },
        },
      },
    });
    expect(result.plan).toEqual({ action: "noop" });
  });

  it("clears on error", () => {
    const result = planTabChangeSummaryWrite({
      currentParam: lineDelta,
      lastSourceKey: "scope-a",
      source: { target: { kind: "uncommitted" } },
      sourceKey: "scope-a",
      state: { kind: "error" },
    });
    expect(result.plan).toEqual({ action: "write", summary: null });
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
