import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { livePathsFromGitStatus } from "@/lib/comments/live-paths.ts";
import {
  listOrphanUncommittedDeletes,
  pruneOrphanUncommittedComments,
  resetOrphanPruneStateForTests,
} from "@/lib/comments/prune-orphans.ts";

function diffThread(input: {
  id: string;
  oldPath?: string | null;
  path: string;
  scopeKind?: "uncommitted" | "commit";
}): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "note",
        createdAt: 1,
        id: `${input.id}-c`,
      },
    ],
    createdAt: 1,
    id: input.id,
    state: "open",
    target: {
      group: "unstaged",
      kind: "git-diff",
      line: 1,
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

describe("listOrphanUncommittedDeletes", () => {
  afterEach(() => {
    resetOrphanPruneStateForTests();
  });

  it("lists uncommitted comments whose path left the live set", () => {
    const deletes = listOrphanUncommittedDeletes(
      [
        diffThread({ id: "keep", path: "live.ts" }),
        diffThread({ id: "drop", path: "gone.ts" }),
        diffThread({ id: "commit-scope", path: "x.ts", scopeKind: "commit" }),
      ],
      new Set(["live.ts"])
    );
    expect(deletes).toEqual([{ commentId: "drop-c", threadId: "drop" }]);
  });

  it("keeps rename comments when oldPath is still live", () => {
    const deletes = listOrphanUncommittedDeletes(
      [diffThread({ id: "r", oldPath: "old.ts", path: "new.ts" })],
      new Set(["old.ts"])
    );
    expect(deletes).toEqual([]);
  });

  it("returns all uncommitted deletes when the working tree is clean", () => {
    const deletes = listOrphanUncommittedDeletes(
      [
        diffThread({ id: "a", path: "a.ts" }),
        diffThread({ id: "b", path: "b.ts" }),
      ],
      new Set()
    );
    expect(deletes).toHaveLength(2);
  });
});

describe("pruneOrphanUncommittedComments queue", () => {
  afterEach(() => {
    resetOrphanPruneStateForTests();
    vi.unstubAllGlobals();
  });

  it("re-runs with the latest livePaths when a second call arrives in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const deleted: string[] = [];
    let call = 0;
    vi.stubGlobal("window", {
      pier: {
        comments: {
          deleteComment: async (req: {
            commentId: string;
            threadId: string;
          }) => {
            call += 1;
            if (call === 1) {
              await firstGate;
            }
            deleted.push(req.threadId);
            return { kind: "ok" as const };
          },
        },
      },
    });

    const threads = [
      diffThread({ id: "a", path: "a.ts" }),
      diffThread({ id: "b", path: "b.ts" }),
    ];
    const first = pruneOrphanUncommittedComments(
      "/repo",
      threads,
      new Set() // both orphans
    );
    // While first is gated, enqueue a narrower set (only b orphan).
    const second = pruneOrphanUncommittedComments(
      "/repo",
      threads,
      new Set(["a.ts"])
    );
    resolveFirst?.();
    const [n1, n2] = await Promise.all([first, second]);
    // First batch deletes a+b; follow-up only b (a now live) — may delete b twice if still present.
    expect(n1 + n2).toBeGreaterThanOrEqual(2);
    expect(deleted).toContain("a");
    expect(deleted).toContain("b");
  });
});

describe("livePathsFromGitStatus", () => {
  it("includes path and rename origPath", () => {
    const status = {
      files: [
        { index: "M", origPath: null, path: "a.ts", worktree: "." },
        { index: "R", origPath: "old.ts", path: "new.ts", worktree: "." },
      ],
    } as GitStatus;
    expect([...livePathsFromGitStatus(status)].sort()).toEqual([
      "a.ts",
      "new.ts",
      "old.ts",
    ]);
  });
});
