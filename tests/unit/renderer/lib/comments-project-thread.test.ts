import type { CommentThread } from "@shared/contracts/comments/base.ts";
import { describe, expect, it } from "vitest";
import { projectComment } from "@/lib/comments/project-thread.ts";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const OTHER = "c".repeat(40);

function gitDiffThread(input: {
  blobOid?: string;
  line: number;
  side?: "new" | "old";
}): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "note",
        createdAt: 1,
        id: "00000000-0000-4000-8000-000000000001",
      },
    ],
    createdAt: 1,
    id: "00000000-0000-4000-8000-000000000002",
    state: "open",
    target: {
      group: "unstaged",
      kind: "git-diff",
      line: input.line,
      oldPath: null,
      path: "a.ts",
      scope: {
        contextId: "ctx",
        gitRootPath: "/repo",
        target: { kind: "uncommitted" },
      },
      side: input.side ?? "new",
      ...(input.blobOid === undefined ? {} : { blobOid: input.blobOid }),
    },
    updatedAt: 2,
  };
}

function markdownThread(hash: string, headingId?: string): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "md",
        createdAt: 1,
        id: "00000000-0000-4000-8000-000000000003",
      },
    ],
    createdAt: 1,
    id: "00000000-0000-4000-8000-000000000004",
    state: "open",
    target: {
      contentHash: hash,
      excerpt: "ex",
      kind: "markdown",
      path: "docs/a.md",
      startLine: 3,
      ...(headingId === undefined ? {} : { headingId }),
    },
    updatedAt: 2,
  };
}

function canvasThread(anchorId?: string): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "c",
        createdAt: 1,
        id: "00000000-0000-4000-8000-000000000005",
      },
    ],
    createdAt: 1,
    id: "00000000-0000-4000-8000-000000000006",
    state: "open",
    target: {
      kind: "canvas",
      path: "x.canvas.tsx",
      ...(anchorId === undefined ? {} : { anchorId }),
    },
    updatedAt: 2,
  };
}

describe("projectComment git-diff", () => {
  const patchInRange = `index ${OLD}..${NEW}\n@@ -10,5 +20,5 @@\n line\n`;

  it("locates when line in hunk and blob matches", () => {
    const result = projectComment(gitDiffThread({ blobOid: NEW, line: 22 }), {
      kind: "git-diff",
      patch: patchInRange,
    });
    expect(result.status).toBe("located");
  });

  it("drifts on blob-mismatch even when line in range", () => {
    const result = projectComment(gitDiffThread({ blobOid: OTHER, line: 22 }), {
      kind: "git-diff",
      patch: patchInRange,
    });
    expect(result).toEqual({
      reason: "blob-mismatch",
      status: "drifted",
    });
  });

  it("drifts when out of range", () => {
    const result = projectComment(gitDiffThread({ line: 99 }), {
      kind: "git-diff",
      patch: patchInRange,
    });
    expect(result.reason).toBe("out-of-range");
  });

  it("locates without blobOid when in range (legacy)", () => {
    const result = projectComment(gitDiffThread({ line: 21 }), {
      kind: "git-diff",
      patch: patchInRange,
    });
    expect(result.status).toBe("located");
  });

  it("drifts when stored blobOid cannot be verified", () => {
    const result = projectComment(gitDiffThread({ blobOid: NEW, line: 22 }), {
      kind: "git-diff",
      patch: "@@ -10,5 +20,5 @@\n line\n",
    });
    expect(result).toEqual({
      reason: "blob-mismatch",
      status: "drifted",
    });
  });
});

describe("projectComment markdown", () => {
  it("locates by headingId", () => {
    const result = projectComment(markdownThread("h", "api"), {
      blockHashes: new Set(),
      filePresent: true,
      headingIds: new Set(["api"]),
      kind: "markdown",
    });
    expect(result.status).toBe("located");
    expect(result.locate?.kind).toBe("markdown-heading");
  });

  it("locates by contentHash", () => {
    const result = projectComment(markdownThread("block-hash"), {
      blockHashes: new Set(["block-hash"]),
      filePresent: true,
      headingIds: new Set(),
      kind: "markdown",
    });
    expect(result.status).toBe("located");
    expect(result.locate?.kind).toBe("markdown-block");
  });

  it("drifts when content changed", () => {
    const result = projectComment(markdownThread("old"), {
      blockHashes: new Set(["new"]),
      filePresent: true,
      headingIds: new Set(),
      kind: "markdown",
    });
    expect(result).toEqual({
      reason: "content-changed",
      status: "drifted",
    });
  });

  it("missing when file gone", () => {
    const result = projectComment(markdownThread("h"), {
      blockHashes: new Set(),
      filePresent: false,
      headingIds: new Set(),
      kind: "markdown",
    });
    expect(result.status).toBe("missing");
  });
});

describe("projectComment canvas", () => {
  it("locates file-level when file present", () => {
    const result = projectComment(canvasThread(), {
      filePresent: true,
      kind: "canvas",
    });
    expect(result.locate?.kind).toBe("canvas-file");
  });

  it("locates anchor when registered", () => {
    const result = projectComment(canvasThread("login"), {
      anchorIds: new Set(["login"]),
      filePresent: true,
      kind: "canvas",
    });
    expect(result.locate?.kind).toBe("canvas-anchor");
  });

  it("drifts when anchor gone", () => {
    const result = projectComment(canvasThread("login"), {
      anchorIds: new Set(["other"]),
      filePresent: true,
      kind: "canvas",
    });
    expect(result.reason).toBe("anchor-gone");
  });
});
