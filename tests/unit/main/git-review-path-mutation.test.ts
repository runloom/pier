import { randomUUID } from "node:crypto";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { applyGitReviewPathMutation } from "@main/services/git-review/git-review-path-mutation.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { describe, expect, it, vi } from "vitest";

const source = {
  contextId: "worktree:test",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" as const },
};

function entry(
  path: string,
  group: "conflict" | "staged" | "unstaged",
  status:
    | "added"
    | "conflicted"
    | "deleted"
    | "modified"
    | "renamed" = "modified",
  oldPaths: readonly string[] = []
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [...oldPaths],
    path,
    renderSlots: [
      {
        group,
        oldPath: oldPaths[0] ?? null,
        sectionKey: `section:${group}:${path}`,
        status,
        targetPath: path,
      },
    ],
    status,
  };
}

function harness(entries: readonly GitReviewIndexEntry[]) {
  const stage = vi.fn(async () => undefined);
  const unstage = vi.fn(async () => undefined);
  const discardChanges = vi.fn(async () => undefined);
  return {
    indexReader: {
      read: vi.fn(async () => ({
        entries: [...entries],
        indexRevision: "index:1",
        kind: "ok" as const,
        warnings: [],
      })),
    },
    writer: {
      applyPatch: vi.fn(),
      discardChanges,
      stage,
      unstage,
    },
  };
}

describe("applyGitReviewPathMutation", () => {
  it("先验证完整路径集合，再将目录暂存合并为一次 writer 调用", async () => {
    const dependencies = harness([
      entry("src/a.ts", "unstaged"),
      entry("src/b.ts", "unstaged", "renamed", ["src/old-b.ts"]),
    ]);

    await expect(
      applyGitReviewPathMutation({
        budget: new GitReviewBudget({
          deadlineAtMs: Date.now() + 10_000,
        }),
        indexReader: dependencies.indexReader,
        request: {
          action: "stage",
          expectedIndexRevision: "index:1",
          operationId: randomUUID(),
          paths: ["src/a.ts", "src/b.ts"],
          source,
        },
        signal: new AbortController().signal,
        writer: dependencies.writer,
      })
    ).resolves.toMatchObject({ kind: "ok" });

    expect(dependencies.writer.stage).toHaveBeenCalledOnce();
    expect(dependencies.writer.stage).toHaveBeenCalledWith("/repo", {
      paths: ["src/a.ts", "src/b.ts", "src/old-b.ts"],
    });
    expect(dependencies.writer.unstage).not.toHaveBeenCalled();
  });

  it("index 修订过期时零写入", async () => {
    const dependencies = harness([entry("src/a.ts", "unstaged")]);
    const result = await applyGitReviewPathMutation({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 10_000 }),
      indexReader: dependencies.indexReader,
      request: {
        action: "stage",
        expectedIndexRevision: "index:stale",
        operationId: randomUUID(),
        paths: ["src/a.ts"],
        source,
      },
      signal: new AbortController().signal,
      writer: dependencies.writer,
    });

    expect(result).toMatchObject({ kind: "error", reason: "staleRevision" });
    expect(dependencies.writer.stage).not.toHaveBeenCalled();
    expect(dependencies.writer.unstage).not.toHaveBeenCalled();
    expect(dependencies.writer.discardChanges).not.toHaveBeenCalled();
  });

  it("任一路径不再属于目标分组时整批零写入", async () => {
    const dependencies = harness([
      entry("src/a.ts", "unstaged"),
      entry("src/b.ts", "staged"),
    ]);
    const result = await applyGitReviewPathMutation({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 10_000 }),
      indexReader: dependencies.indexReader,
      request: {
        action: "stage",
        expectedIndexRevision: "index:1",
        operationId: randomUUID(),
        paths: ["src/a.ts", "src/b.ts"],
        source,
      },
      signal: new AbortController().signal,
      writer: dependencies.writer,
    });

    expect(result).toMatchObject({ kind: "error", reason: "changeNotFound" });
    expect(dependencies.writer.stage).not.toHaveBeenCalled();
  });

  it("目录丢弃在确认后的最终路径集合上只调用一次 writer", async () => {
    const dependencies = harness([
      entry("src/a.ts", "unstaged", "modified"),
      entry("src/new.ts", "unstaged", "added"),
    ]);
    const result = await applyGitReviewPathMutation({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 10_000 }),
      indexReader: dependencies.indexReader,
      request: {
        action: "revert",
        expectedIndexRevision: "index:1",
        operationId: randomUUID(),
        paths: ["src/a.ts", "src/new.ts"],
        source,
      },
      signal: new AbortController().signal,
      writer: dependencies.writer,
    });

    expect(result.kind).toBe("ok");
    expect(dependencies.writer.discardChanges).toHaveBeenCalledOnce();
    expect(dependencies.writer.discardChanges).toHaveBeenCalledWith("/repo", {
      paths: ["src/a.ts", "src/new.ts"],
    });
  });
});
