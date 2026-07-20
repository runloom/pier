import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeGitReviewCommand } from "@main/app-core/git-review-commands.ts";
import {
  GIT_REVIEW_DEADLINE_MS,
  GitReviewBudget,
} from "@main/services/git-review/git-review-budget.ts";
import { describe, expect, it, vi } from "vitest";

const OPERATION_ID = "c4883f41-047b-4f05-b858-9207eb0617d0";
const EXECUTION_CONTEXT = {
  clientId: "desktop-renderer:window-1",
  navigationGeneration: 3,
  webContentsId: 17,
  windowRecordId: "record-1",
} as const;

function services(input?: {
  canonicalContextId?: string;
  canonicalRoot?: string;
}) {
  const getIndex = vi.fn(async (request, options) => {
    const resolved = await options.resolveSource(request.source, {
      budget: options.budget,
      signal: options.budget.signal,
    });
    if (resolved.kind === "error") {
      return resolved;
    }
    return {
      kind: "error",
      message: null,
      reason: "internal",
      retryable: true,
    };
  });
  const cancelReviewRequest = vi.fn();
  const value = {
    gitReview: { cancelReviewRequest, getIndex },
    panelContexts: {
      resolveForPath: vi.fn().mockResolvedValue({
        contextId: input?.canonicalContextId ?? "context-1",
        gitRoot: input?.canonicalRoot ?? "/canonical/repo",
      }),
    },
  } as unknown as PierCoreServices;
  return { cancelReviewRequest, getIndex, value };
}

describe("executeGitReviewCommand", () => {
  it("用 PanelContext 规范根目录并把可信窗口身份作为 owner", async () => {
    const fixture = services();
    const result = await executeGitReviewCommand(
      "request-1",
      {
        request: {
          operationId: OPERATION_ID,
          source: {
            contextId: "context-1",
            gitRootPath: "/alias/repo",
            target: { kind: "uncommitted" },
          },
        },
        type: "git.getReviewIndex",
      },
      fixture.value,
      EXECUTION_CONTEXT
    );

    expect(result).toMatchObject({ ok: true, requestId: "request-1" });
    expect(fixture.getIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          contextId: "context-1",
          gitRootPath: "/alias/repo",
          target: { kind: "uncommitted" },
        },
      }),
      expect.objectContaining({
        budget: expect.any(GitReviewBudget),
        owner: {
          clientId: "desktop-renderer:window-1",
          generation: 3,
          windowRecordId: "record-1:webContents:17",
        },
        resolveSource: expect.any(Function),
      })
    );
    expect(fixture.value.panelContexts.resolveForPath).toHaveBeenCalledWith(
      "/alias/repo",
      {
        budget: expect.any(GitReviewBudget),
        signal: expect.any(AbortSignal),
      }
    );
  });

  it("拒绝 contextId 不匹配且不进入 Git 索引读取", async () => {
    const fixture = services({ canonicalContextId: "another-context" });
    const result = await executeGitReviewCommand(
      "request-2",
      {
        request: {
          operationId: OPERATION_ID,
          source: {
            contextId: "context-1",
            gitRootPath: "/repo",
            target: { kind: "uncommitted" },
          },
        },
        type: "git.getReviewIndex",
      },
      fixture.value,
      EXECUTION_CONTEXT
    );

    expect(result).toMatchObject({
      data: { kind: "error", reason: "invalidSource", retryable: false },
      ok: true,
    });
    expect(fixture.getIndex).toHaveBeenCalledOnce();
  });

  it("取消只使用调用窗口的可信 owner", async () => {
    const fixture = services();
    await executeGitReviewCommand(
      "request-3",
      {
        request: { operationId: OPERATION_ID },
        type: "git.cancelReviewRequest",
      },
      fixture.value,
      EXECUTION_CONTEXT
    );

    expect(fixture.cancelReviewRequest).toHaveBeenCalledWith(
      { operationId: OPERATION_ID },
      {
        clientId: "desktop-renderer:window-1",
        generation: 3,
        windowRecordId: "record-1:webContents:17",
      }
    );
  });

  it("规范路径解析计入从命令入口开始的统一期限", async () => {
    const fixture = services();
    const result = await executeGitReviewCommand(
      "request-4",
      {
        request: {
          operationId: OPERATION_ID,
          source: {
            contextId: "context-1",
            gitRootPath: "/repo",
            target: { kind: "uncommitted" },
          },
        },
        type: "git.getReviewIndex",
      },
      fixture.value,
      {
        ...EXECUTION_CONTEXT,
        requestStartedAtMs: Date.now() - GIT_REVIEW_DEADLINE_MS,
      }
    );

    expect(result).toMatchObject({
      data: { kind: "error", reason: "timeout", retryable: true },
      ok: true,
    });
    expect(fixture.value.panelContexts.resolveForPath).not.toHaveBeenCalled();
    expect(fixture.getIndex).toHaveBeenCalledOnce();
  });
});
