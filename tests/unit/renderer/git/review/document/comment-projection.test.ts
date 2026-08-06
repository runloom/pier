import type { PierDiffReviewCommentThread } from "@pier/ui/diff-view/index.tsx";
import {
  classifyInlineDrift,
  indexReviewComments,
  parseHunkLineRanges,
} from "@plugins/builtin/git/renderer/review/document/comment-projection.ts";
import type {
  CommentItem,
  CommentThread,
} from "@shared/contracts/comments/base.ts";
import { describe, expect, it } from "vitest";

const SCOPE = {
  contextId: "ctx:abc",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" },
} as const;

function makeComment(id: string, opts?: { deletedAt?: number }): CommentItem {
  return {
    author: { kind: "user" },
    body: `comment ${id}`,
    createdAt: 1000,
    ...(opts?.deletedAt === undefined ? {} : { deletedAt: opts.deletedAt }),
    id,
  };
}

function makeDiffThread(options: {
  group?: "unstaged" | "staged" | "conflict" | "committed";
  path?: string;
  side?: "old" | "new";
  line?: number;
  threadId?: string;
  comments?: CommentItem[];
}): CommentThread {
  const group = options.group ?? "unstaged";
  return {
    comments: options.comments ?? [makeComment("c1")],
    createdAt: 1000,
    id: options.threadId ?? "t1",
    state: "open",
    target: {
      kind: "git-diff",
      group,
      line: options.line ?? 5,
      oldPath: null,
      path: options.path ?? "src/a.ts",
      scope: SCOPE,
      side: options.side ?? "new",
    },
    updatedAt: 2000,
  };
}

describe("indexReviewComments", () => {
  it("returns an empty index for no threads", () => {
    const index = indexReviewComments([]);
    expect(index.size).toBe(0);
    expect(index.get("unstaged", "src/a.ts")).toEqual([]);
  });

  it("maps a git-diff thread to a lean PierDiffReviewCommentThread", () => {
    const index = indexReviewComments([makeDiffThread({ threadId: "t1" })]);
    expect(index.size).toBe(1);
    const threads = index.get("unstaged", "src/a.ts");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toEqual({
      line: 5,
      side: "additions",
      threadId: "t1",
    });
  });

  it("maps target.side old → deletions, new → additions", () => {
    const index = indexReviewComments([
      makeDiffThread({ side: "old", threadId: "t1" }),
      makeDiffThread({ side: "new", path: "src/b.ts", threadId: "t2" }),
    ]);
    expect(index.get("unstaged", "src/a.ts")[0]?.side).toBe("deletions");
    expect(index.get("unstaged", "src/b.ts")[0]?.side).toBe("additions");
  });

  it("keeps a thread with any live comment (count not projected)", () => {
    const index = indexReviewComments([
      makeDiffThread({
        threadId: "t1",
        comments: [
          makeComment("c1"),
          makeComment("c2"),
          makeComment("c3", { deletedAt: 3000 }),
        ],
      }),
    ]);
    expect(index.get("unstaged", "src/a.ts")).toEqual([
      { line: 5, side: "additions", threadId: "t1" },
    ]);
  });

  it("skips threads where every comment is deleted", () => {
    const index = indexReviewComments([
      makeDiffThread({
        threadId: "t1",
        comments: [
          makeComment("c1", { deletedAt: 3000 }),
          makeComment("c2", { deletedAt: 3001 }),
        ],
      }),
    ]);
    expect(index.size).toBe(0);
    expect(index.get("unstaged", "src/a.ts")).toEqual([]);
  });

  it("indexes (group, path) separately: same path across groups", () => {
    const index = indexReviewComments([
      makeDiffThread({ group: "unstaged", threadId: "t1" }),
      makeDiffThread({ group: "staged", threadId: "t2" }),
    ]);
    expect(index.size).toBe(2);
    expect(index.get("unstaged", "src/a.ts")).toHaveLength(1);
    expect(index.get("staged", "src/a.ts")).toHaveLength(1);
    expect(index.get("unstaged", "src/a.ts")[0]?.threadId).toBe("t1");
    expect(index.get("staged", "src/a.ts")[0]?.threadId).toBe("t2");
  });

  it("groups multiple threads on the same (group, path)", () => {
    const index = indexReviewComments([
      makeDiffThread({ line: 5, threadId: "t1" }),
      makeDiffThread({ line: 10, threadId: "t2" }),
    ]);
    expect(index.size).toBe(1);
    const threads = index.get("unstaged", "src/a.ts");
    expect(threads).toHaveLength(2);
    expect(threads[0]?.line).toBe(5);
    expect(threads[1]?.line).toBe(10);
  });

  it("indexes git-file target threads as file-level drift (no line/side)", () => {
    const thread: CommentThread = {
      comments: [makeComment("c1")],
      createdAt: 1000,
      id: "t1",
      state: "open",
      target: { kind: "git-file", path: "src/a.ts", scope: SCOPE },
      updatedAt: 2000,
    };
    const index = indexReviewComments([thread]);
    // 行内 size 不计 git-file；文件级走 getFileDrift。
    expect(index.size).toBe(0);
    expect(index.getFileDrift("src/a.ts")).toEqual([{ threadId: "t1" }]);
  });
});

function makeInlineThread(opts: {
  line: number;
  side?: "additions" | "deletions";
  threadId?: string;
}): PierDiffReviewCommentThread {
  return {
    line: opts.line,
    side: opts.side ?? "additions",
    threadId: opts.threadId ?? "t1",
  };
}

describe("parseHunkLineRanges", () => {
  it("returns empty ranges for an empty patch", () => {
    const ranges = parseHunkLineRanges("");
    expect(ranges.old).toEqual([]);
    expect(ranges.new).toEqual([]);
  });

  it("parses a single hunk with explicit lengths", () => {
    const ranges = parseHunkLineRanges("@@ -10,3 +20,2 @@\n context\n");
    expect(ranges.old).toEqual([[10, 12]]);
    expect(ranges.new).toEqual([[20, 21]]);
  });

  it("defaults a missing length to 1", () => {
    const ranges = parseHunkLineRanges("@@ -5 +8 @@\n line\n");
    expect(ranges.old).toEqual([[5, 5]]);
    expect(ranges.new).toEqual([[8, 8]]);
  });

  it("parses multiple hunks into ordered ranges", () => {
    const ranges = parseHunkLineRanges(
      "@@ -1,2 +3,2 @@\na\nb\n@@ -10,2 +20,2 @@\nc\nd\n"
    );
    expect(ranges.old).toEqual([
      [1, 2],
      [10, 11],
    ]);
    expect(ranges.new).toEqual([
      [3, 4],
      [20, 21],
    ]);
  });
});

describe("classifyInlineDrift", () => {
  it("returns empty for no inline candidates", () => {
    const result = classifyInlineDrift([], "@@ -1 +1 @@\n");
    expect(result.inline).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  it("keeps an in-range line as inline", () => {
    const result = classifyInlineDrift(
      [makeInlineThread({ line: 22, side: "additions" })],
      "@@ -10,5 +20,5 @@\n line\n"
    );
    expect(result.inline).toHaveLength(1);
    expect(result.inline[0]?.threadId).toBe("t1");
    expect(result.drift).toEqual([]);
  });

  it("moves an out-of-range line to drift with lean fields", () => {
    const result = classifyInlineDrift(
      [
        makeInlineThread({
          line: 99,
          side: "additions",
          threadId: "t9",
        }),
      ],
      "@@ -10,2 +20,2 @@\n line\n"
    );
    expect(result.inline).toEqual([]);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toEqual({
      line: 99,
      side: "additions",
      threadId: "t9",
    });
  });

  it("splits mixed in-range and out-of-range threads", () => {
    const result = classifyInlineDrift(
      [
        makeInlineThread({ line: 21, side: "additions", threadId: "in" }),
        makeInlineThread({ line: 99, side: "additions", threadId: "out" }),
      ],
      "@@ -10,5 +20,5 @@\n line\n"
    );
    expect(result.inline.map((thread) => thread.threadId)).toEqual(["in"]);
    expect(result.drift.map((thread) => thread.threadId)).toEqual(["out"]);
  });

  it("checks deletions against old ranges and additions against new ranges", () => {
    const result = classifyInlineDrift(
      [
        makeInlineThread({ line: 12, side: "deletions", threadId: "old-in" }),
        makeInlineThread({ line: 22, side: "additions", threadId: "new-in" }),
        makeInlineThread({ line: 12, side: "additions", threadId: "new-out" }),
        makeInlineThread({ line: 22, side: "deletions", threadId: "old-out" }),
      ],
      "@@ -10,5 +20,5 @@\n line\n"
    );
    expect(result.inline.map((thread) => thread.threadId).sort()).toEqual([
      "new-in",
      "old-in",
    ]);
    expect(result.drift.map((thread) => thread.threadId).sort()).toEqual([
      "new-out",
      "old-out",
    ]);
  });

  it("treats an empty patch as all drift", () => {
    const result = classifyInlineDrift(
      [makeInlineThread({ line: 5, side: "additions" })],
      ""
    );
    expect(result.inline).toEqual([]);
    expect(result.drift).toHaveLength(1);
  });
});
