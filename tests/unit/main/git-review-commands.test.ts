import type { CommandExecutionContext } from "@main/app-core/command-execution-context.ts";
import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeGitReviewCommand } from "@main/app-core/git-review-commands.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { describe, expect, it, vi } from "vitest";

const operationId = "00000000-0000-4000-8000-000000000001";
const source = {
  contextId: "worktree:test",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" as const },
};
const executionContext = {
  clientId: "renderer:test",
  navigationGeneration: 1,
  requestStartedAtMs: Date.now(),
  webContentsId: 1,
  windowRecordId: "window:test",
} as CommandExecutionContext;

function services(
  result: { readonly kind: "error" } | { readonly kind: "ok" }
) {
  const pulse = vi.fn();
  return {
    pulse,
    value: {
      git: {},
      gitReview: {
        applyMutation: vi.fn(
          async (
            _request: unknown,
            options: {
              readonly onCommitted?: (gitRootPath: string) => void;
            }
          ) => {
            if (result.kind === "ok") {
              options.onCommitted?.("/canonical/repo");
              return { kind: "ok", operationId };
            }
            return {
              kind: "error",
              message: "failed",
              reason: "commandFailed",
              retryable: true,
            };
          }
        ),
        applyPathMutation: vi.fn(
          async (
            _request: unknown,
            options: {
              readonly onCommitted?: (gitRootPath: string) => void;
            }
          ) => {
            if (result.kind === "ok") {
              options.onCommitted?.("/canonical/repo");
              return { kind: "ok", operationId };
            }
            return {
              kind: "error",
              message: "failed",
              reason: "commandFailed",
              retryable: true,
            };
          }
        ),
      },
      gitWatch: { pulse },
    } as unknown as PierCoreServices,
  };
}

describe("executeGitReviewCommand mutation delivery", () => {
  it.each<{ command: PierCommand; label: string }>([
    {
      command: {
        request: {
          action: "stage",
          expectedRevision: `sha256:${"0".repeat(64)}`,
          operationId,
          source: { ...source, oldPaths: [], path: "src/a.ts" },
          target: { kind: "file", sectionKey: "section:unstaged" },
        },
        type: "git.applyReviewMutation",
      },
      label: "文件/变更块",
    },
    {
      command: {
        request: {
          action: "stage",
          expectedIndexRevision: `sha256:${"1".repeat(64)}`,
          operationId,
          paths: ["src/a.ts"],
          source,
        },
        type: "git.applyReviewPathMutation",
      },
      label: "目录树路径集合",
    },
  ])("成功的$label写入主动 pulse Git watch", async ({ command }) => {
    const fixture = services({ kind: "ok" });

    await executeGitReviewCommand(
      "request:1",
      command,
      fixture.value,
      executionContext
    );

    expect(fixture.pulse).toHaveBeenCalledOnce();
    expect(fixture.pulse).toHaveBeenCalledWith("/canonical/repo");
  });

  it("失败写入不发布虚假的 Git watch pulse", async () => {
    const fixture = services({ kind: "error" });
    const command = {
      request: {
        action: "stage" as const,
        expectedIndexRevision: `sha256:${"1".repeat(64)}`,
        operationId,
        paths: ["src/a.ts"],
        source,
      },
      type: "git.applyReviewPathMutation" as const,
    };

    await executeGitReviewCommand(
      "request:1",
      command,
      fixture.value,
      executionContext
    );

    expect(fixture.pulse).not.toHaveBeenCalled();
  });
});
