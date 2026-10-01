import { gitReviewConflictResolveRequestSchema } from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";

const source = {
  contextId: "worktree:test",
  gitRootPath: "/repo",
  oldPaths: [],
  path: "conflict.ts",
  target: { kind: "uncommitted" },
};
const operationId = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";

describe("conflict resolution evidence", () => {
  it.each([
    "ours",
    "theirs",
    "stage",
    "write",
  ])("rejects %s without the conflict state observed by the client", (action) => {
    const result = gitReviewConflictResolveRequestSchema.safeParse({
      action,
      operationId,
      resolvedContents: action === "write" ? "resolved\n" : undefined,
      source,
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Resolution without observed state was accepted");
    }
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
      "expectedContentsDigest",
    ]);
  });

  it("rejects write without a resolved body even with fresh evidence", () => {
    const result = gitReviewConflictResolveRequestSchema.safeParse({
      action: "write",
      expectedContentsDigest: `sha256:${"a".repeat(64)}`,
      operationId,
      source,
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Resolution without a body was accepted");
    }
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
      "resolvedContents",
    ]);
  });
});
