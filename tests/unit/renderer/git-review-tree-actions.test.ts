import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  GIT_REVIEW_OPEN_FILE_COMMAND_ID,
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/git-review-tree-actions.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

function collectActionIds(
  entries: ReturnType<typeof buildMenuEntries>
): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type === "action") {
      ids.push(entry.id);
    }
  }
  return ids;
}

describe("git review tree actions", () => {
  const openInEditor = vi.fn(() => true);
  const error = vi.fn();
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    actionRegistry.clearForTests();
    openInEditor.mockClear();
    openInEditor.mockReturnValue(true);
    error.mockClear();
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
    } as unknown as RendererPluginContext;
    dispose = registerGitReviewTreeActions(context);
  });

  afterEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
  });

  it("shows Open File only for file tree items", () => {
    const fileMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(collectActionIds(fileMenu)).toContain(
      GIT_REVIEW_OPEN_FILE_COMMAND_ID
    );

    const directoryMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "directory",
        path: "src",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(collectActionIds(directoryMenu)).not.toContain(
      GIT_REVIEW_OPEN_FILE_COMMAND_ID
    );
  });

  it("opens the file in the files panel", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_FILE_COMMAND_ID);
    expect(action).toBeDefined();
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(openInEditor).toHaveBeenCalledWith({
      context: expect.objectContaining({
        contextId: "ctx",
        gitRoot: "/repo",
        projectRootPath: "/repo",
      }),
      path: "src/a.ts",
      root: "/repo",
      title: "a.ts",
    });
  });

  it("notifies when files panel is unavailable", async () => {
    openInEditor.mockReturnValue(false);
    const action = actionRegistry.get(GIT_REVIEW_OPEN_FILE_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(error).toHaveBeenCalledWith("Unable to open file");
  });
});
