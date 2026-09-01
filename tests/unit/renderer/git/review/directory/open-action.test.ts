import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_CHANGES_PANEL_ID } from "@plugins/builtin/git/manifest.ts";
import { GIT_REVIEW_DIFF_SURFACE } from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import {
  GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID,
  GIT_REVIEW_TAB_SURFACE,
  registerGitReviewOpenDirectoryAction,
  resolveGitReviewOpenDirectoryTarget,
} from "@plugins/builtin/git/renderer/review/directory/open-action.ts";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

describe("resolveGitReviewOpenDirectoryTarget", () => {
  it("omits path for group roots without repoPath", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          kind: "directory",
          path: "\u0001Changes",
        },
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      })
    ).toEqual({ contextId: "ctx", gitRootPath: "/repo" });
  });

  it("uses repoPath for tree files", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          kind: "file",
          path: "\u0001Changes/src/a.ts",
          repoPath: "src/a.ts",
        },
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      })
    ).toEqual({
      contextId: "ctx",
      gitRootPath: "/repo",
      path: "src/a.ts",
    });
  });

  it("uses the diff file path", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          path: "src/a.ts",
        },
        surface: GIT_REVIEW_DIFF_SURFACE,
      })
    ).toEqual({
      contextId: "ctx",
      gitRootPath: "/repo",
      path: "src/a.ts",
    });
  });

  it("returns null without a git root", () => {
    expect(resolveGitReviewOpenDirectoryTarget({ metadata: {} })).toBeNull();
  });

  it("opens the review git root from the Changes tab", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget({
        sourcePanelComponent: GIT_CHANGES_PANEL_ID,
        sourcePanelContext: {
          contextId: "ctx",
          cwd: "/repo/packages/ui",
          gitRoot: "/repo",
          projectRootPath: "/repo",
          source: "panel",
          updatedAt: 1,
          worktreeKey: "/repo",
          worktreeRoot: "/repo",
        },
        sourcePanelId: "review-1",
        surface: GIT_REVIEW_TAB_SURFACE,
      })
    ).toEqual({ contextId: "ctx", gitRootPath: "/repo" });
  });

  it("prefers the panel source over a nested cwd on the tab", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget(
        {
          sourcePanelComponent: GIT_CHANGES_PANEL_ID,
          sourcePanelContext: {
            contextId: "ctx",
            cwd: "/repo/packages/ui",
            gitRoot: "/repo",
            projectRootPath: "/repo",
            source: "panel",
            updatedAt: 1,
            worktreeKey: "/repo",
            worktreeRoot: "/repo",
          },
          sourcePanelId: "review-1",
          surface: GIT_REVIEW_TAB_SURFACE,
        },
        {
          reviewScopeForPanel: (panelId) =>
            panelId === "review-1"
              ? { contextId: "ctx", gitRootPath: "/other" }
              : null,
        }
      )
    ).toEqual({ contextId: "ctx", gitRootPath: "/other" });
  });

  it("hides on non-review tabs", () => {
    expect(
      resolveGitReviewOpenDirectoryTarget({
        sourcePanelComponent: "terminal",
        sourcePanelContext: {
          contextId: "ctx",
          cwd: "/repo",
          gitRoot: "/repo",
          projectRootPath: "/repo",
          source: "panel",
          updatedAt: 1,
          worktreeKey: "/repo",
          worktreeRoot: "/repo",
        },
        sourcePanelId: "term-1",
        surface: GIT_REVIEW_TAB_SURFACE,
      })
    ).toBeNull();
  });
});

describe("registerGitReviewOpenDirectoryAction", () => {
  const openProjectDirectory = vi.fn(
    async (): Promise<{
      instanceId?: string;
      ok: boolean;
      reason?: string;
      reused?: boolean;
    }> => ({
      instanceId: "pier.files.filePanel:project:x",
      ok: true,
      reused: false,
    })
  );
  const error = vi.fn();
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
    openProjectDirectory.mockClear();
    openProjectDirectory.mockResolvedValue({
      instanceId: "pier.files.filePanel:project:x",
      ok: true,
      reused: false,
    });
    error.mockClear();
    const context = {
      actions: {
        register: (action: Parameters<typeof actionRegistry.register>[0]) =>
          actionRegistry.register(action),
      },
      files: { openProjectDirectory },
      i18n: {
        t: (_key: string, _values: unknown, fallback: string) => fallback,
      },
      notifications: { error },
      panels: {
        listInstances: (componentId: string) =>
          componentId === GIT_CHANGES_PANEL_ID
            ? [
                {
                  componentId: GIT_CHANGES_PANEL_ID,
                  groupId: "g1",
                  id: "review-1",
                  params: {
                    source: {
                      contextId: "ctx",
                      gitRootPath: "/repo",
                      target: { kind: "uncommitted" },
                    },
                  },
                  title: "Changes",
                },
              ]
            : [],
      },
    } as unknown as RendererPluginContext;
    dispose = registerGitReviewOpenDirectoryAction(context);
  });

  it("opens the project root from a group row", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "directory",
        path: "\u0001Changes",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(openProjectDirectory).toHaveBeenCalledWith({
      context: expect.objectContaining({
        contextId: "ctx",
        gitRoot: "/repo",
        projectRootPath: "/repo",
      }),
      root: "/repo",
    });
  });

  it("reports failure without opening an editor", async () => {
    openProjectDirectory.mockResolvedValueOnce({
      ok: false,
      reason: "files-unregistered",
    });
    const action = actionRegistry.get(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(error).toHaveBeenCalledWith("Unable to open project directory");
  });

  it("is not on the command palette surface", () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
    expect(action?.surfaces).toEqual([
      GIT_REVIEW_TREE_ITEM_SURFACE,
      GIT_REVIEW_DIFF_SURFACE,
      GIT_REVIEW_TAB_SURFACE,
    ]);
    expect(action?.surfaces).not.toContain("command-palette");
  });

  it("opens the project root from the Changes tab", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
    await action?.handler({
      sourcePanelComponent: GIT_CHANGES_PANEL_ID,
      sourcePanelId: "review-1",
      surface: GIT_REVIEW_TAB_SURFACE,
    });
    expect(openProjectDirectory).toHaveBeenCalledWith({
      context: expect.objectContaining({
        contextId: "ctx",
        gitRoot: "/repo",
        projectRootPath: "/repo",
      }),
      root: "/repo",
    });
  });

  it("shows on the Changes tab and hides on a terminal tab", () => {
    const reviewIds = buildMenuEntries(GIT_REVIEW_TAB_SURFACE, {
      sourcePanelComponent: GIT_CHANGES_PANEL_ID,
      sourcePanelId: "review-1",
      surface: GIT_REVIEW_TAB_SURFACE,
    })
      .filter((entry) => entry.type === "action")
      .map((entry) => entry.id);
    expect(reviewIds).toContain(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);

    const terminalIds = buildMenuEntries(GIT_REVIEW_TAB_SURFACE, {
      sourcePanelComponent: "terminal",
      sourcePanelId: "term-1",
      surface: GIT_REVIEW_TAB_SURFACE,
    })
      .filter((entry) => entry.type === "action")
      .map((entry) => entry.id);
    expect(terminalIds).not.toContain(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
  });

  it("sorts after review/view groups, not with copy or Finder", () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID);
    expect(action?.metadata?.group).toBe("5_open");
    expect(action?.metadata?.sortOrder).toBe(1);
  });
});
