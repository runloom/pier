import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import { resolveGitReviewDiffOpenTarget } from "@plugins/builtin/git/renderer/review/diff-open-target.ts";
import { describe, expect, it, vi } from "vitest";

function item(path: string, id = "item-a"): PierDiffViewItem {
  return {
    cacheKey: `${id}:0`,
    fileDisplay: { path, status: "modified" },
    id,
    patch: `diff --git a/${path} b/${path}\n`,
  };
}

function handle(partial: {
  selection?: ReturnType<PierDiffViewHandle["getSelectedLines"]>;
  hit?: ReturnType<PierDiffViewHandle["resolvePointerLineHit"]>;
}): PierDiffViewHandle {
  return {
    resolvePointerLineHit: vi.fn(() => partial.hit ?? null),
    getSelectedLines: vi.fn(() => partial.selection ?? null),
    getSelectedText: vi.fn(() => ""),
  } as unknown as PierDiffViewHandle;
}

const event = {
  composedPath: () => [],
  target: null,
} as unknown as MouseEvent;

describe("resolveGitReviewDiffOpenTarget", () => {
  it("uses selection start when the hit is inside an additions selection", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-a",
          lineNumber: 13,
          side: "additions",
        },
        selection: {
          id: "item-a",
          range: { start: 12, end: 15, side: "additions" },
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts", line: 12 });
  });

  it("uses the pointer line when the hit is outside the selection", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-a",
          lineNumber: 20,
          side: "additions",
        },
        selection: {
          id: "item-a",
          range: { start: 12, end: 15, side: "additions" },
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts", line: 20 });
  });

  it("falls back to pointer line when there is no selection", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: true,
          id: "item-a",
          lineNumber: 42,
          side: "additions",
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts", line: 42 });
  });

  it("omits line for pure deletion-side hits", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-a",
          lineNumber: 7,
          side: "deletions",
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts" });
  });

  it("omits line for pure deletion-side selection without hit", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        selection: {
          id: "item-a",
          range: { start: 3, end: 5, side: "deletions" },
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts" });
  });

  it("uses selection line when there is no pointer hit", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        selection: {
          id: "item-a",
          range: { start: 8, end: 10, side: "additions" },
        },
      }),
      items: [item("src/a.ts")],
    });
    expect(target).toEqual({ path: "src/a.ts", line: 8 });
  });

  it("prefers hit item path over selection on another item", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-b",
          lineNumber: 4,
          side: "additions",
        },
        selection: {
          id: "item-a",
          range: { start: 1, end: 2, side: "additions" },
        },
      }),
      items: [item("src/a.ts", "item-a"), item("src/b.ts", "item-b")],
    });
    expect(target).toEqual({ path: "src/b.ts", line: 4 });
  });

  it("returns null when handle is missing", () => {
    expect(
      resolveGitReviewDiffOpenTarget({
        event,
        handle: null,
        items: [item("src/a.ts")],
      })
    ).toBeNull();
  });

  it("returns null when path is missing", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-a",
          lineNumber: 1,
          side: "additions",
        },
      }),
      items: [{ id: "item-a" } as PierDiffViewItem],
    });
    expect(target).toBeNull();
  });

  it("omits line for cross-side selection and falls back to additions hit", () => {
    const target = resolveGitReviewDiffOpenTarget({
      event,
      handle: handle({
        hit: {
          fromNumberColumn: false,
          id: "item-a",
          lineNumber: 9,
          side: "additions",
        },
        selection: {
          id: "item-a",
          range: {
            start: 1,
            end: 2,
            side: "deletions",
            endSide: "additions",
          },
        },
      }),
      items: [item("src/a.ts")],
    });
    // Cross-side selection is not a continuous span → hit wins.
    expect(target).toEqual({ path: "src/a.ts", line: 9 });
  });
});
