import {
  buildWorktreeRef,
  worktreeRefSchema,
  worktreeRefsEqual,
} from "@shared/contracts/local-control/worktree-ref.ts";
import { describe, expect, it } from "vitest";

describe("WorktreeRef", () => {
  it("builds absolute worktreeKey/rootPath and keeps incarnation", () => {
    const ref = buildWorktreeRef({
      path: "/tmp/repo.worktree/feature-a",
      gitRoot: "/tmp/repo",
      branch: "feature/a",
      incarnationId: "inc-1",
    });
    expect(ref.worktreeKey).toBe(ref.rootPath);
    expect(ref.gitRoot).toContain("repo");
    expect(ref.branch).toBe("feature/a");
    expect(ref.incarnationId).toBe("inc-1");
    expect(worktreeRefSchema.parse(ref)).toEqual(ref);
  });

  it("equality requires same incarnation", () => {
    const a = buildWorktreeRef({
      path: "/tmp/wt",
      incarnationId: "a",
    });
    const b = buildWorktreeRef({
      path: "/tmp/wt",
      incarnationId: "b",
    });
    expect(worktreeRefsEqual(a, a)).toBe(true);
    expect(worktreeRefsEqual(a, b)).toBe(false);
  });
});
