import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";
import {
  buildReviewCommentNavTargets,
  mapCommentSideToDiffView,
} from "../../../../src/plugins/builtin/git/renderer/review/comments/nav-targets.ts";

function entry(
  path: string,
  sectionKey: string,
  group: "staged" | "unstaged" = "unstaged"
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    path,
    renderSlots: [
      {
        group,
        oldPath: null,
        sectionKey,
      },
    ],
  } as unknown as GitReviewIndexEntry;
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
  it("orders by entry list then line and skips other surfaces/deleted/file targets", () => {
    const targets = buildReviewCommentNavTargets({
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
      "t-b",
      "t-a1",
      "t-a2",
    ]);
    expect(targets[1]).toMatchObject({
      sectionKey: "sec-a",
      side: "old",
    });
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
