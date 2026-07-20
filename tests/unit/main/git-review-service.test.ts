import { randomUUID } from "node:crypto";
import type { ExecGitRaw } from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import type { GitReviewIndexResolution } from "@main/services/git-review/git-review-index.ts";
import {
  type GitReviewRequestOptions,
  GitReviewService,
  type GitReviewSourceResolver,
} from "@main/services/git-review/git-review-service.ts";
import {
  type GitReviewFileDocumentRequest,
  gitReviewIndexOkSchema,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it, vi } from "vitest";
import {
  gitReviewRequestOptions,
  TEST_GIT_REVIEW_OWNER,
} from "./git-review-test-fixtures.ts";

function request(): GitReviewFileDocumentRequest {
  return {
    operationId: randomUUID(),
    source: {
      contextId: "worktree:test",
      gitRootPath: "/repo",
      oldPaths: [],
      path: "missing.ts",
      target: { kind: "uncommitted" },
    },
  };
}

describe("GitReviewService boundary", () => {
  it("非法请求在启动 Git 前返回不可重试 invalidSource", async () => {
    const service = new GitReviewService();
    const invalid = { ...request(), operationId: "not-a-uuid" };

    await expect(
      service.getFileDocument(
        invalid as GitReviewFileDocumentRequest,
        gitReviewRequestOptions()
      )
    ).resolves.toEqual({
      kind: "error",
      message: "Git Review document 请求非法",
      reason: "invalidSource",
      retryable: false,
    });
  });

  it("已到期预算在授权器执行前返回 timeout", async () => {
    const now = () => 100;
    const expired = new GitReviewBudget({ deadlineAtMs: 100, now });
    const options = gitReviewRequestOptions(expired);
    const resolveSourceCalled = vi.fn();
    const resolveSource: GitReviewSourceResolver = async (source) => {
      resolveSourceCalled();
      return { kind: "ok", value: source };
    };

    await expect(
      new GitReviewService().getFileDocument(request(), {
        ...options,
        resolveSource,
      })
    ).resolves.toMatchObject({ kind: "error", reason: "timeout" });
    expect(resolveSourceCalled).not.toHaveBeenCalled();
  });

  it("授权器尚未完成时取消，旧请求不会进入索引", async () => {
    const resolve = vi.fn();
    const service = new GitReviewService({
      indexReader: { read: vi.fn(), resolve },
    });
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const input = request();
    const options: GitReviewRequestOptions = {
      ...gitReviewRequestOptions(),
      resolveSource: async () => {
        markStarted();
        return new Promise(() => undefined);
      },
    };

    const result = service.getFileDocument(input, options);
    await started;
    service.cancelReviewRequest(
      { operationId: input.operationId },
      TEST_GIT_REVIEW_OWNER
    );

    await expect(result).resolves.toMatchObject({
      kind: "error",
      reason: "aborted",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("授权器永不完成仍受请求 deadline 约束", async () => {
    const budget = new GitReviewBudget({ deadlineAtMs: Date.now() + 20 });

    await expect(
      new GitReviewService().getFileDocument(request(), {
        ...gitReviewRequestOptions(budget),
        resolveSource: async () => new Promise(() => undefined),
      })
    ).resolves.toMatchObject({ kind: "error", reason: "timeout" });
  });

  it("授权结果仍须通过同一请求 schema", async () => {
    const resolve = vi.fn();
    const service = new GitReviewService({
      indexReader: { read: vi.fn(), resolve },
    });
    const options = gitReviewRequestOptions();

    await expect(
      service.getFileDocument(request(), {
        ...options,
        resolveSource: async (source) => ({
          kind: "ok",
          value: { ...source, gitRootPath: "relative/repository" },
        }),
      })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "invalidSource",
      retryable: false,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("路径深度警告不会把已不存在的目标误报为输出上限", async () => {
    const result = gitReviewIndexOkSchema.parse({
      entries: [],
      kind: "ok",
      warnings: [{ code: "pathDepthExceeded", skipped: 1 }],
    });
    const resolution: GitReviewIndexResolution = {
      kind: "ok",
      metadata: {
        canonicalRoot: "/repo",
        headOid: null,
        indexRevision: "revision",
        rangeBounds: null,
      },
      resolvedEntries: [],
      result,
    };
    const service = new GitReviewService({
      indexReader: { read: vi.fn(), resolve: async () => resolution },
    });

    await expect(
      service.getFileDocument(request(), gitReviewRequestOptions())
    ).resolves.toEqual({ kind: "unchanged" });
  });

  it("确定性 patch 协议错误只执行一次", async () => {
    const entry = {
      entryKey: "entry",
      oldPaths: [],
      path: "missing.ts",
      renderSlots: [
        {
          group: "staged",
          oldPath: null,
          sectionKey: "section:missing",
          status: "deleted",
          targetPath: "missing.ts",
        },
      ],
      status: "deleted",
    } as const;
    const result = gitReviewIndexOkSchema.parse({
      entries: [entry],
      kind: "ok",
      warnings: [],
    });
    const resolution: GitReviewIndexResolution = {
      kind: "ok",
      metadata: {
        canonicalRoot: "/repo",
        headOid: "1".repeat(40),
        indexRevision: "revision",
        rangeBounds: null,
      },
      resolvedEntries: [
        {
          groupFacts: {
            unstaged: {
              movement: null,
              oldPath: null,
              origin: "tracked",
              sourceOid: null,
              statsExpected: true,
              status: "deleted",
              targetOid: null,
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
      indexReader: { read: vi.fn(), resolve: async () => resolution },
    });

    await expect(
      service.getFileDocument(request(), gitReviewRequestOptions())
    ).resolves.toMatchObject({
      kind: "error",
      reason: "internal",
      retryable: false,
    });
    expect(exec).toHaveBeenCalledOnce();
  });
});
