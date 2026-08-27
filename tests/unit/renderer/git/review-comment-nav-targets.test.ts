import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import {
  buildReviewCommentNavTargets,
  mapCommentSideToDiffView,
  revealReviewCommentNavTarget,
} from "../../../../src/plugins/builtin/git/renderer/review/comments/nav-targets.ts";

function entry(
  path: string,
  sectionKey: string,
  group: "staged" | "unstaged" = "unstaged"
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    status: "modified",
    renderSlots: [
      {
        group,
        oldPath: null,
        sectionKey,
        status: "modified",
        targetPath: path,
      },
    ],
  };
}

function thread(input: {
  readonly id: string;
  readonly line: number;
  readonly path: string;
  readonly side?: "new" | "old";
  readonly group?: "staged" | "unstaged";
  readonly deleted?: boolean;
  readonly kind?: "git-diff" | "git-file";
}): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "x",
        createdAt: 1,
        id: `c-${input.id}`,
        ...(input.deleted === true ? { deletedAt: 2 } : {}),
      },
    ],
    createdAt: 1,
    id: input.id,
    target:
      input.kind === "git-file"
        ? {
            kind: "git-file",
            path: input.path,
            scope: {
              contextId: "ctx",
              gitRootPath: "/repo",
              target: { kind: "uncommitted" },
            },
          }
        : {
            group: input.group ?? "unstaged",
            kind: "git-diff",
            line: input.line,
            oldPath: null,
            path: input.path,
            scope: {
              contextId: "ctx",
              gitRootPath: "/repo",
              target: { kind: "uncommitted" },
            },
            side: input.side ?? "new",
          },
    updatedAt: 1,
  } as unknown as CommentThread;
}

describe("buildReviewCommentNavTargets", () => {
  it("orders by tree presentation then line and skips other surfaces/deleted/file targets", () => {
    const targets = buildReviewCommentNavTargets({
      // Index array order is b then a; tree path order is a then b.
      entries: [entry("b.ts", "sec-b"), entry("a.ts", "sec-a")],
      surface: "index",
      threads: [
        thread({ id: "t-a2", line: 20, path: "a.ts" }),
        thread({ id: "t-b", line: 1, path: "b.ts" }),
        thread({ id: "t-a1", line: 3, path: "a.ts", side: "old" }),
        thread({ id: "t-staged", group: "staged", line: 1, path: "a.ts" }),
        thread({ id: "t-del", deleted: true, line: 9, path: "a.ts" }),
        thread({ id: "t-file", kind: "git-file", line: 1, path: "a.ts" }),
      ],
    });
    expect(targets.map((item) => item.threadId)).toEqual([
      "t-a1",
      "t-a2",
      "t-b",
    ]);
    expect(targets[0]).toMatchObject({
      sectionKey: "sec-a",
      side: "old",
    });
  });

  it("uses collidingFileLabel so nav order matches presentation ledger", () => {
    const entries = [entry("a", "sec-a-file"), entry("a/b", "sec-a-b")];
    const label = (name: string) => `(file) ${name}`;
    const targets = buildReviewCommentNavTargets({
      collidingFileLabel: label,
      entries,
      surface: "index",
      threads: [
        thread({ id: "t-file", line: 1, path: "a" }),
        thread({ id: "t-nested", line: 1, path: "a/b" }),
      ],
    });
    // Under a/: `(file) a` before `b` by segment order.
    expect(targets.map((item) => item.threadId)).toEqual([
      "t-file",
      "t-nested",
    ]);
  });

  it("returns empty when threads are null", () => {
    expect(
      buildReviewCommentNavTargets({
        entries: [entry("a.ts", "sec-a")],
        surface: "index",
        threads: null,
      })
    ).toEqual([]);
  });

  it("maps comment sides for scrollToLine", () => {
    expect(mapCommentSideToDiffView("old")).toBe("deletions");
    expect(mapCommentSideToDiffView("new")).toBe("additions");
  });
});

function navTarget(
  path: string,
  sectionKey: string
): Parameters<typeof revealReviewCommentNavTarget>[0]["target"] {
  return {
    commentId: "c1",
    entryKey: `entry:${path}`,
    group: "unstaged",
    line: 12,
    path,
    sectionKey,
    side: "new",
    threadId: "t1",
  };
}

describe("revealReviewCommentNavTarget", () => {
  it("scrolls in place only when the target file is already visible", () => {
    const scrollToLine = vi.fn(() => true);
    const onRequestTreeOpen = vi.fn();
    revealReviewCommentNavTarget({
      handle: {
        isItemVisible: (id) => id === "sec-a",
        scrollToLine,
      },
      onRequestTreeOpen,
      target: navTarget("a.ts", "sec-a"),
    });
    expect(scrollToLine).toHaveBeenCalledWith("sec-a", 12, "additions");
    expect(onRequestTreeOpen).not.toHaveBeenCalled();
  });

  it("tree-opens with reveal after navigating to another file", () => {
    const scrollToLine = vi.fn(() => true);
    const onRequestTreeOpen = vi.fn();
    revealReviewCommentNavTarget({
      handle: {
        isItemVisible: () => false,
        scrollToLine,
      },
      onRequestTreeOpen,
      target: navTarget("a.ts", "sec-a"),
    });
    expect(scrollToLine).not.toHaveBeenCalled();
    expect(onRequestTreeOpen).toHaveBeenCalledWith(
      "entry:a.ts",
      "sec-a",
      "unstaged",
      { line: 12, side: "new" }
    );
  });

  it("tree-opens when in-place scrollToLine fails", () => {
    const onRequestTreeOpen = vi.fn();
    revealReviewCommentNavTarget({
      handle: {
        isItemVisible: () => true,
        scrollToLine: () => false,
      },
      onRequestTreeOpen,
      target: navTarget("a.ts", "sec-a"),
    });
    expect(onRequestTreeOpen).toHaveBeenCalledTimes(1);
  });
});
