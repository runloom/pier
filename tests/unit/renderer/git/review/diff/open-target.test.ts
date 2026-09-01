import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import {
  resolveGitReviewDiffCopyRange,
  resolveGitReviewDiffOpenTarget,
  resolveGitReviewLiveCopyTarget,
} from "@plugins/builtin/git/renderer/review/diff-open-target.ts";
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
  topAnchorId?: string;
}): PierDiffViewHandle {
  return {
    captureTopAnchor: vi.fn(() =>
      partial.topAnchorId ? { id: partial.topAnchorId, offset: 0 } : null
    ),
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

describe("resolveGitReviewDiffCopyRange", () => {
  it("uses an additions-only selection span on the same item", () => {
    expect(
      resolveGitReviewDiffCopyRange({
        handle: handle({
          selection: {
            id: "item-a",
            range: { start: 15, end: 12, side: "additions" },
          },
        }),
        itemId: "item-a",
      })
    ).toEqual({ endLine: 15, startLine: 12 });
  });

  it("ignores another item's selection and uses the working-tree line", () => {
    expect(
      resolveGitReviewDiffCopyRange({
        handle: handle({
          selection: {
            id: "item-a",
            range: { start: 1, end: 4, side: "additions" },
          },
        }),
        itemId: "item-b",
        line: 9,
      })
    ).toEqual({ endLine: 9, startLine: 9 });
  });

  it("uses a deletions-only selection as the copied line span", () => {
    expect(
      resolveGitReviewDiffCopyRange({
        handle: handle({
          selection: {
            id: "item-a",
            range: { start: 3, end: 5, side: "deletions" },
          },
        }),
        itemId: "item-a",
      })
    ).toEqual({ endLine: 5, startLine: 3 });
  });
});

describe("resolveGitReviewLiveCopyTarget", () => {
  it("attaches a range only when the selection is still in the item list", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({
          selection: {
            id: "item-a",
            range: { start: 10, end: 14, side: "additions" },
          },
        }),
        items: [item("src/a.ts", "item-a")],
      })
    ).toEqual({
      endLine: 14,
      gitRootPath: "/repo",
      path: "src/a.ts",
      startLine: 10,
    });
  });

  it("does not mix a leftover selection onto a fallback file", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({
          selection: {
            id: "item-a",
            range: { start: 10, end: 14, side: "additions" },
          },
        }),
        items: [item("src/b.ts", "item-b")],
      })
    ).toEqual({
      gitRootPath: "/repo",
      path: "src/b.ts",
    });
  });

  it("returns null when multiple items have no matching selection", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({}),
        items: [item("src/a.ts", "item-a"), item("src/b.ts", "item-b")],
      })
    ).toBeNull();
  });

  it("keeps a diff line selection over the tree-selected file", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({
          selection: {
            id: "item-b",
            range: { start: 2, end: 2, side: "additions" },
          },
        }),
        items: [item("src/a.ts", "item-a"), item("src/b.ts", "item-b")],
        preferredItemId: "item-a",
      })
    ).toEqual({
      endLine: 2,
      gitRootPath: "/repo",
      path: "src/b.ts",
      startLine: 2,
    });
  });

  it("prefers the tree-selected item over the viewport-top file", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({ topAnchorId: "item-b" }),
        items: [item("src/a.ts", "item-a"), item("src/b.ts", "item-b")],
        preferredItemId: "item-a",
      })
    ).toEqual({
      gitRootPath: "/repo",
      path: "src/a.ts",
    });
  });

  it("does not copy the viewport-top file when nothing is selected", () => {
    expect(
      resolveGitReviewLiveCopyTarget({
        gitRootPath: "/repo",
        handle: handle({ topAnchorId: "item-b" }),
        items: [item("src/a.ts", "item-a"), item("src/b.ts", "item-b")],
      })
    ).toBeNull();
  });
});
