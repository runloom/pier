import {
  GIT_REVIEW_DIFF_SURFACE,
  GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
  parseGitReviewDiffOpenMetadata,
  registerGitReviewDiffActions,
} from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import {
  GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID,
  registerGitReviewOpenDirectoryAction,
} from "@plugins/builtin/git/renderer/review/directory/open-action.ts";
import { GIT_REVIEW_TREE_ITEM_SURFACE } from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { parseGitReviewTreeItemMetadata } from "@plugins/builtin/git/renderer/review/tree-item-model.ts";
import {
  GIT_REVIEW_COPY_PATH_COMMAND_ID,
  GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID,
  GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID,
  GIT_REVIEW_REVEAL_COMMAND_ID,
  registerGitReviewLiveCopyTarget,
  registerGitReviewTreePathActions,
} from "@plugins/builtin/git/renderer/review/tree-path-actions.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

function menuSketch(
  entries: ReturnType<typeof buildMenuEntries>
): Array<"|" | string> {
  return entries.map((entry) => {
    if (entry.type === "separator") {
      return "|";
    }
    if (entry.type === "action" || entry.type === "checkbox") {
      return entry.id;
    }
    return entry.type === "role" ? entry.role : entry.label;
  });
}

describe("git review diff open actions", () => {
  const openInEditor = vi.fn(() => true);
  const error = vi.fn();
  const success = vi.fn();
  const reveal = vi.fn(async () => undefined);
  let dispose: (() => void) | undefined;

  const context = {
    actions: {
      register: (action: Parameters<typeof actionRegistry.register>[0]) =>
        actionRegistry.register(action),
    },
    dialogs: {
      alert: vi.fn(async () => undefined),
    },
    files: {
      openInEditor,
      openProjectDirectory: vi.fn(async () => ({
        instanceId: "x",
        ok: true,
        reused: false,
      })),
      reveal,
    },
    i18n: {
      t: (_key: string, _values: unknown, fallback: string) => fallback,
    },
    notifications: { error, success },
  } as never;

  beforeEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
    openInEditor.mockClear();
    openInEditor.mockReturnValue(true);
    error.mockClear();
    success.mockClear();
    reveal.mockClear();
    const disposeDiff = registerGitReviewDiffActions(context);
    const disposeDirectory = registerGitReviewOpenDirectoryAction(context);
    const disposePath = registerGitReviewTreePathActions({
      context,
      parseItem: parseGitReviewTreeItemMetadata,
      surfaces: [GIT_REVIEW_TREE_ITEM_SURFACE, GIT_REVIEW_DIFF_SURFACE],
    });
    dispose = () => {
      disposeDiff();
      disposeDirectory();
      disposePath();
    };
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

  it("shows path-with-range on the diff surface", () => {
    const menu = buildMenuEntries(GIT_REVIEW_DIFF_SURFACE, {
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        line: 18,
        path: "src/a.ts",
        selectionEndLine: 21,
        selectionStartLine: 18,
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(menuSketch(menu)).toEqual([
      GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
      "|",
      GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID,
      "|",
      GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID,
      GIT_REVIEW_REVEAL_COMMAND_ID,
    ]);
  });

  it("keeps path-with-range visible like the editor when there is no line span", () => {
    const menu = buildMenuEntries(GIT_REVIEW_DIFF_SURFACE, {
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(menuSketch(menu)).toEqual([
      GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
      "|",
      GIT_REVIEW_OPEN_DIRECTORY_COMMAND_ID,
      "|",
      GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID,
      GIT_REVIEW_REVEAL_COMMAND_ID,
    ]);
  });

  it("copies absolute, relative, and ranged paths from diff metadata", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await actionRegistry.get(GIT_REVIEW_COPY_PATH_COMMAND_ID)?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_DIFF_SURFACE,
    });
    expect(writeText).toHaveBeenCalledWith("/repo/src/a.ts");

    writeText.mockClear();
    await actionRegistry
      .get(GIT_REVIEW_COPY_RELATIVE_PATH_COMMAND_ID)
      ?.handler({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          path: "src/a.ts",
        },
        surface: GIT_REVIEW_DIFF_SURFACE,
      });
    expect(writeText).toHaveBeenCalledWith("src/a.ts");

    writeText.mockClear();
    await actionRegistry
      .get(GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID)
      ?.handler({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          path: "src/a.ts",
          selectionEndLine: 21,
          selectionStartLine: 18,
        },
        surface: GIT_REVIEW_DIFF_SURFACE,
      });
    expect(writeText).toHaveBeenCalledWith("src/a.ts:18-21");

    writeText.mockClear();
    await actionRegistry
      .get(GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID)
      ?.handler({
        metadata: {
          contextId: "ctx",
          gitRootPath: "/repo",
          path: "src/a.ts",
        },
        surface: GIT_REVIEW_DIFF_SURFACE,
      });
    expect(writeText).toHaveBeenCalledWith("src/a.ts");
  });

  it("copies the live review target when the shortcut has no menu metadata", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const disposeLive = registerGitReviewLiveCopyTarget("panel-1", () => ({
      endLine: 14,
      gitRootPath: "/repo",
      path: "src/live.ts",
      startLine: 10,
    }));

    await actionRegistry
      .get(GIT_REVIEW_COPY_PATH_WITH_RANGE_COMMAND_ID)
      ?.handler({
        sourcePanelId: "panel-1",
        surface: GIT_REVIEW_DIFF_SURFACE,
      });
    disposeLive();

    expect(writeText).toHaveBeenCalledWith("src/live.ts:10-14");
  });
});
