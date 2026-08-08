import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { navigateGitGutterToReview } from "@plugins/builtin/files/renderer/editor/git-gutter-navigate.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it, vi } from "vitest";

function panelContext(overrides?: Partial<PanelContext>): PanelContext {
  return {
    contextId: "ctx-1",
    gitRoot: "/repo",
    projectRootPath: "/repo",
    worktreeRoot: "/repo",
    ...overrides,
  } as PanelContext;
}

describe("navigateGitGutterToReview", () => {
  it("delegates with allowGroupFallback and no hardcoded group", () => {
    const openUncommittedChanges = vi.fn(() => true);
    const context = {
      git: { openUncommittedChanges },
    } as unknown as RendererPluginContext;

    const ok = navigateGitGutterToReview({
      context,
      line: 42,
      panelContext: panelContext(),
      path: "src/a.ts",
    });

    expect(ok).toBe(true);
    expect(openUncommittedChanges).toHaveBeenCalledWith({
      panelContext: expect.objectContaining({ contextId: "ctx-1" }),
      pendingReveal: {
        allowGroupFallback: true,
        line: 42,
        path: "src/a.ts",
        side: "new",
      },
    });
  });

  it("returns false when git facade missing", () => {
    const context = {} as RendererPluginContext;
    expect(
      navigateGitGutterToReview({
        context,
        line: 1,
        panelContext: panelContext(),
        path: "a.ts",
      })
    ).toBe(false);
  });
});
