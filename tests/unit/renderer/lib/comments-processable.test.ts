import type { CommentThread } from "@shared/contracts/comments/base.ts";
import { describe, expect, it } from "vitest";
import {
  formatCommentsForComposer,
  listProcessableComments,
  mergeComposerText,
  pathInLiveSet,
  processableCommentCount,
} from "@/lib/comments/processable.ts";

function thread(input: {
  body: string;
  group?: "unstaged" | "staged";
  id: string;
  line: number;
  oldPath?: string | null;
  path: string;
  scopeKind?: "uncommitted" | "commit";
}): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: input.body,
        createdAt: 1,
        id: `${input.id}-c`,
      },
    ],
    createdAt: 1,
    id: input.id,
    state: "open",
    target: {
      blobOid: "a".repeat(40),
      group: input.group ?? "unstaged",
      kind: "git-diff",
      line: input.line,
      oldPath: input.oldPath === undefined ? null : input.oldPath,
      path: input.path,
      scope: {
        contextId: "ctx",
        gitRootPath: "/repo",
        target:
          input.scopeKind === "commit"
            ? { kind: "commit", oid: "b".repeat(40) }
            : { kind: "uncommitted" },
      },
      side: "new",
    },
    updatedAt: 2,
  };
}

describe("pathInLiveSet", () => {
  it("matches path or oldPath", () => {
    const live = new Set(["new.ts"]);
    expect(pathInLiveSet("new.ts", null, live)).toBe(true);
    expect(pathInLiveSet("old.ts", "new.ts", live)).toBe(true);
    expect(pathInLiveSet("gone.ts", "also-gone.ts", live)).toBe(false);
  });
});

describe("listProcessableComments", () => {
  it("keeps uncommitted git-diff threads with live bodies", () => {
    const items = listProcessableComments([
      thread({ body: "fix me", id: "t1", line: 12, path: "a.ts" }),
      thread({
        body: "orphan commit scope",
        id: "t2",
        line: 1,
        path: "b.ts",
        scopeKind: "commit",
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.threadId).toBe("t1");
    expect(items[0]?.oldPath).toBeNull();
    expect(
      processableCommentCount([
        thread({ body: "fix me", id: "t1", line: 12, path: "a.ts" }),
        thread({
          body: "x",
          id: "t2",
          line: 1,
          path: "b.ts",
          scopeKind: "commit",
        }),
      ])
    ).toBe(1);
  });

  it("filters out comments whose path left the uncommitted change set", () => {
    const threads = [
      thread({ body: "still dirty", id: "t1", line: 1, path: "live.ts" }),
      thread({ body: "already committed", id: "t2", line: 2, path: "gone.ts" }),
    ];
    const livePaths = new Set(["live.ts"]);
    const items = listProcessableComments(threads, { livePaths });
    expect(items.map((item) => item.threadId)).toEqual(["t1"]);
    expect(processableCommentCount(threads, { livePaths })).toBe(1);
    expect(processableCommentCount(threads, { livePaths: new Set() })).toBe(0);
  });

  it("keeps a comment when only oldPath is still live (rename edge)", () => {
    const threads = [
      thread({
        body: "on rename",
        id: "t1",
        line: 1,
        oldPath: "old.ts",
        path: "new.ts",
      }),
    ];
    const viaOld = listProcessableComments(threads, {
      livePaths: new Set(["old.ts"]),
    });
    expect(viaOld).toHaveLength(1);
    expect(viaOld[0]?.oldPath).toBe("old.ts");
    expect(
      listProcessableComments(threads, { livePaths: new Set(["other.ts"]) })
    ).toHaveLength(0);
  });

  it("sorts by path then line", () => {
    const items = listProcessableComments([
      thread({ body: "b", id: "t2", line: 20, path: "z.ts" }),
      thread({ body: "a", id: "t1", line: 3, path: "a.ts" }),
      thread({ body: "c", id: "t3", line: 1, path: "a.ts" }),
    ]);
    expect(items.map((item) => item.threadId)).toEqual(["t3", "t1", "t2"]);
  });

  it("emits every live comment in a thread (not only the first)", () => {
    const multi: CommentThread = {
      ...thread({ body: "first", id: "t-multi", line: 8, path: "m.ts" }),
      comments: [
        {
          author: { kind: "user" },
          body: "first",
          createdAt: 1,
          id: "t-multi-c1",
        },
        {
          author: { kind: "user" },
          body: "  ",
          createdAt: 2,
          id: "t-multi-empty",
        },
        {
          author: { kind: "user" },
          body: "second",
          createdAt: 3,
          deletedAt: 9,
          id: "t-multi-deleted",
        },
        {
          author: { kind: "user" },
          body: "third",
          createdAt: 4,
          id: "t-multi-c2",
        },
      ],
    };
    const items = listProcessableComments([multi]);
    expect(items.map((item) => item.commentId)).toEqual([
      "t-multi-c1",
      "t-multi-c2",
    ]);
    expect(items.map((item) => item.body)).toEqual(["first", "third"]);
    expect(processableCommentCount([multi])).toBe(2);
  });
});

describe("formatCommentsForComposer", () => {
  it("builds a readable bullet block", () => {
    const text = formatCommentsForComposer(
      listProcessableComments([
        thread({ body: "rename helper", id: "t1", line: 4, path: "src/a.ts" }),
      ])
    );
    expect(text).toContain("Please address these review comments:");
    expect(text).toContain("`src/a.ts:4`");
    expect(text).toContain("rename helper");
    expect(text).not.toMatch(/staged|unstaged/i);
  });
});

describe("mergeComposerText", () => {
  it("appends with a blank line when draft is non-empty", () => {
    expect(mergeComposerText("hello", "world")).toBe("hello\n\nworld");
    expect(mergeComposerText("", "world")).toBe("world");
  });
});
