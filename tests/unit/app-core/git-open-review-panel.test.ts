/**
 * git.openReviewPanel（移动端 S2 与桌面同步打开审查面板）main 侧处理器：
 * 作用域以 panel-context-resolver 的 gitRoot 为准；非 git 目录拒绝；
 * renderer 结果透传 panelId。
 */

import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeGitCommand } from "@main/app-core/commands/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it, vi } from "vitest";

function contextFor(gitRoot: string | null): PanelContext {
  return {
    contextId: "ctx-1",
    cwd: "/repo/packages/ui",
    projectRootPath: gitRoot ?? "/repo/packages/ui",
    updatedAt: 1,
    worktreeKey: gitRoot ?? "/repo/packages/ui",
    ...(gitRoot ? { gitRoot } : {}),
  };
}

function servicesFor(overrides: {
  context?: PanelContext;
  rendererResult?: unknown;
  windows?: Array<{ focused?: boolean; id: string }>;
}): {
  executeMock: ReturnType<typeof vi.fn>;
  resolveMock: ReturnType<typeof vi.fn>;
  services: PierCoreServices;
} {
  const executeMock = vi.fn(
    async () =>
      overrides.rendererResult ?? {
        data: { panelId: "pier.git.changes:ctx-1:uncommitted" },
        ok: true,
        requestId: "rc-1",
      }
  );
  const resolveMock = vi.fn(
    async () => overrides.context ?? contextFor("/repo")
  );
  const services = {
    panelContexts: { resolveForPath: resolveMock },
    rendererCommand: { execute: executeMock },
    window: {
      list: () => overrides.windows ?? [{ focused: true, id: "main" }],
    },
  } as unknown as PierCoreServices;
  return { executeMock, resolveMock, services };
}

describe("git.openReviewPanel handler", () => {
  it("resolves scope via panel-context resolver and forwards to the focused window", async () => {
    const { executeMock, resolveMock, services } = servicesFor({});
    const result = await executeGitCommand(
      "req-1",
      { cwd: "/repo/packages/ui", type: "git.openReviewPanel" },
      services
    );
    expect(resolveMock).toHaveBeenCalledWith("/repo/packages/ui");
    expect(executeMock).toHaveBeenCalledWith({
      context: contextFor("/repo"),
      type: "git.openReviewPanel",
      windowId: "main",
    });
    expect(result).toEqual({
      data: {
        gitRootPath: "/repo",
        panelId: "pier.git.changes:ctx-1:uncommitted",
      },
      ok: true,
      requestId: "req-1",
    });
  });

  it("rejects non-git directories with git_error (PC parity: no review outside a repo)", async () => {
    const { executeMock, services } = servicesFor({
      context: contextFor(null),
    });
    const result = await executeGitCommand(
      "req-2",
      { cwd: "/Users/me/Downloads", type: "git.openReviewPanel" },
      services
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: { code: "git_error" },
      ok: false,
      requestId: "req-2",
    });
  });

  it("fails when no renderer window is available", async () => {
    const { services } = servicesFor({ windows: [] });
    const result = await executeGitCommand(
      "req-3",
      { cwd: "/repo", type: "git.openReviewPanel" },
      services
    );
    expect(result).toMatchObject({ ok: false, requestId: "req-3" });
  });

  it("passes renderer failures through with their error code", async () => {
    const { services } = servicesFor({
      rendererResult: {
        error: {
          code: "platform_unavailable",
          message: "git changes panel is unavailable in this window",
        },
        ok: false,
        requestId: "rc-2",
      },
    });
    const result = await executeGitCommand(
      "req-4",
      { cwd: "/repo", type: "git.openReviewPanel" },
      services
    );
    expect(result).toEqual({
      error: {
        code: "platform_unavailable",
        message: "git changes panel is unavailable in this window",
      },
      ok: false,
      requestId: "req-4",
    });
  });
});
