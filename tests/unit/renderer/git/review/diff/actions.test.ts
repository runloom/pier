import {
  GIT_REVIEW_DIFF_SURFACE,
  GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
  parseGitReviewDiffOpenMetadata,
  registerGitReviewDiffActions,
} from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

describe("git review diff open actions", () => {
  const openInEditor = vi.fn(() => true);
  const error = vi.fn();
  let dispose: (() => void) | undefined;

  const context = {
    actions: {
      register: (action: Parameters<typeof actionRegistry.register>[0]) =>
        actionRegistry.register(action),
    },
    files: { openInEditor },
    i18n: {
      t: (_key: string, _values: unknown, fallback: string) => fallback,
    },
    notifications: { error },
  } as never;

  beforeEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
    openInEditor.mockClear();
    openInEditor.mockReturnValue(true);
    error.mockClear();
    dispose = registerGitReviewDiffActions(context);
  });

  it("shows Jump to Source when path metadata is present", () => {
    const menu = buildMenuEntries(GIT_REVIEW_DIFF_SURFACE, {
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        line: 18,
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    const ids = menu
      .filter((entry) => entry.type === "action")
      .map((entry) => entry.id);
    expect(ids).toContain(GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID);
  });

  it("opens the editor at the resolved line", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        line: 18,
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(openInEditor).toHaveBeenCalledWith({
      context: expect.objectContaining({
        contextId: "ctx",
        cwd: "/repo",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        worktreeKey: "/repo",
        worktreeRoot: "/repo",
      }),
      line: 18,
      path: "src/a.ts",
      root: "/repo",
      title: "a.ts",
    });
  });

  it("prefers source panel context and still fills missing cwd", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        line: 4,
        path: "src/a.ts",
      },
      sourcePanelContext: {
        branch: "main",
        contextId: "ctx",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeKey: "/repo",
        worktreeRoot: "/repo",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(openInEditor).toHaveBeenCalledWith({
      context: expect.objectContaining({
        branch: "main",
        contextId: "ctx",
        cwd: "/repo",
        gitRoot: "/repo",
        projectRootPath: "/repo",
      }),
      line: 4,
      path: "src/a.ts",
      root: "/repo",
      title: "a.ts",
    });
  });

  it("parses metadata strictly", () => {
    expect(
      parseGitReviewDiffOpenMetadata({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          line: 3.5,
          path: "a.ts",
        },
      })
    ).toEqual({ contextId: "ctx", gitRootPath: "/repo", path: "a.ts" });
  });
});
