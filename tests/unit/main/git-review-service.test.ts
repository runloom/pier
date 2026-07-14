import { randomUUID } from "node:crypto";
import type { ExecGitRaw } from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import type { GitReviewIndexResolution } from "@main/services/git-review/git-review-index.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import {
  type GitReviewFileDocumentRequest,
  gitReviewIndexOkSchema,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it, vi } from "vitest";

function request(): GitReviewFileDocumentRequest {
  return {
    clientHasDocument: false,
    ifRevision: null,
    operationId: randomUUID(),
    source: {
      contextId: "worktree:test",
      gitRootPath: "/repo",
      path: "missing.ts",
      query: { groups: ["unstaged"], kind: "uncommitted" },
    },
  };
}

describe("GitReviewService boundary", () => {
  it("非法请求在启动 Git 前返回不可重试 invalidSource", async () => {
    const service = new GitReviewService();
    const invalid = { ...request(), operationId: "not-a-uuid" };

    await expect(
      service.getFileDocument(invalid as GitReviewFileDocumentRequest)
    ).resolves.toEqual({
      kind: "error",
      message: "Git Review document 请求非法",
      reason: "invalidSource",
      retryable: false,
    });
  });

  it("预先取消与已到期预算保持 aborted/timeout，不误报 stale", async () => {
    const controller = new AbortController();
    controller.abort();
    const now = () => 100;
    const expired = new GitReviewBudget({ deadlineAtMs: 100, now });
    const service = new GitReviewService({ now });

    await expect(
      service.getFileDocument(request(), { signal: controller.signal })
    ).resolves.toMatchObject({ kind: "error", reason: "aborted" });
    await expect(
      service.getFileDocument(request(), { budget: expired })
    ).resolves.toMatchObject({ kind: "error", reason: "timeout" });
  });

  it("canonicalize await 期间取消后不进入调度或索引", async () => {
    const controller = new AbortController();
    let releaseCanonicalize: (value: string) => void = () => undefined;
    const canonicalized = new Promise<string>((resolve) => {
      releaseCanonicalize = resolve;
    });
    const resolve = vi.fn();
    const service = new GitReviewService({
      canonicalizeRoot: () => canonicalized,
      indexReader: { resolve },
    });

    const result = service.getFileDocument(request(), {
      signal: controller.signal,
    });
    controller.abort();
    releaseCanonicalize("/repo");

    await expect(result).resolves.toMatchObject({
      kind: "error",
      reason: "aborted",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("canonicalize 永不完成时仍受完整请求 deadline 约束", async () => {
    const budget = new GitReviewBudget({ deadlineAtMs: Date.now() + 20 });
    const service = new GitReviewService({
      canonicalizeRoot: () => new Promise<string>(() => undefined),
    });

    await expect(
      service.getFileDocument(request(), { budget })
    ).resolves.toMatchObject({ kind: "error", reason: "timeout" });
  });

  it("索引已截断且目标不在发布窗口时返回 outputLimit，不暗示 unchanged", async () => {
    const result = gitReviewIndexOkSchema.parse({
      durationMs: 0,
      entries: [],
      gitRootPath: "/repo",
      kind: "ok",
      query: {
        groups: ["unstaged"],
        headOid: null,
        indexToken: "index",
        kind: "uncommitted",
      },
      revision: "revision",
      sourceQuery: { groups: ["unstaged"], kind: "uncommitted" },
      warnings: [{ code: "filesTruncated", limit: 2000, omitted: null }],
    });
    const resolution: GitReviewIndexResolution = {
      kind: "ok",
      resolvedEntries: [],
      result,
    };
    const service = new GitReviewService({
      indexReader: { resolve: async () => resolution },
    });

    await expect(service.getFileDocument(request())).resolves.toMatchObject({
      kind: "error",
      reason: "outputLimit",
      retryable: true,
    });
  });

  it("确定性 patch 协议错误只执行一次，并返回不可重试 internal", async () => {
    const entry = {
      additions: 0,
      deletions: 1,
      entryKey: "entry",
      groups: ["unstaged"],
      groupStatuses: { unstaged: "deleted" },
      oldPaths: [],
      path: "missing.ts",
      status: "deleted",
    } as const;
    const result = gitReviewIndexOkSchema.parse({
      durationMs: 0,
      entries: [entry],
      gitRootPath: "/repo",
      kind: "ok",
      query: {
        groups: ["unstaged"],
        headOid: "1".repeat(40),
        indexToken: "index",
        kind: "uncommitted",
      },
      revision: "revision",
      sourceQuery: { groups: ["unstaged"], kind: "uncommitted" },
      warnings: [],
    });
    const resolution: GitReviewIndexResolution = {
      kind: "ok",
      resolvedEntries: [
        {
          groupFacts: {
            unstaged: {
              movement: null,
              oldPath: null,
              origin: "tracked",
              statsExpected: true,
              status: "deleted",
              targetPath: "missing.ts",
            },
          },
          path: "missing.ts",
        },
      ],
      result,
    };
    const exec = vi.fn(async () => ({
      kind: "collected" as const,
      stderrBytes: 0,
      stderrTail: Buffer.alloc(0),
      stdout: Buffer.from("malformed", "utf8"),
      stdoutBytes: 9,
    })) satisfies ExecGitRaw;
    const service = new GitReviewService({
      execGitRaw: exec,
      indexReader: { resolve: async () => resolution },
    });

    await expect(service.getFileDocument(request())).resolves.toMatchObject({
      kind: "error",
      reason: "internal",
      retryable: false,
    });
    expect(exec).toHaveBeenCalledOnce();
  });
});
