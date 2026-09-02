import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_COMMAND_ID,
  FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
  FILES_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_DELETE_COMMAND_ID,
  FILES_DUPLICATE_COMMAND_ID,
  FILES_EDITOR_ADD_CURSOR_ABOVE_COMMAND_ID,
  FILES_EDITOR_ADD_CURSOR_BELOW_COMMAND_ID,
  FILES_EDITOR_COPY_COMMAND_ID,
  FILES_EDITOR_CUT_COMMAND_ID,
  FILES_EDITOR_GO_TO_LINE_COMMAND_ID,
  FILES_EDITOR_PASTE_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_OCCURRENCES_COMMAND_ID,
  FILES_EDITOR_SELECT_NEXT_OCCURRENCE_COMMAND_ID,
  FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
  FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID,
  FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
  FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
  FILES_FILE_CLIPBOARD_PASTE_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
  FILES_NEW_FILE_COMMAND_ID,
  FILES_NEW_FOLDER_COMMAND_ID,
  FILES_RENAME_COMMAND_ID,
  FILES_REVEAL_COMMAND_ID,
  FILES_SEARCH_COPY_MATCH_COMMAND_ID,
  FILES_SEARCH_COPY_PATH_COMMAND_ID,
  FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_SEARCH_IN_FOLDER_COMMAND_ID,
  FILES_SEARCH_OPEN_HIT_COMMAND_ID,
  FILES_SEARCH_REVEAL_COMMAND_ID,
  FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
  FILES_TREE_EXPAND_ALL_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import {
  createFilesEditorActions,
  createFilesEditorPrefsActions,
} from "@plugins/builtin/files/renderer/editor/actions.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { createFilesMarkdownPreviewActions } from "@plugins/builtin/files/renderer/markdown/preview-actions.ts";
import {
  writeMarkdownMeasureMode,
  writeMarkdownReadingAppearance,
} from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { createSearchInFolderAction } from "@plugins/builtin/files/renderer/search/actions.ts";
import { createFilesSearchResultActions } from "@plugins/builtin/files/renderer/search/context-actions.ts";
import { createFilesTreeActions } from "@plugins/builtin/files/renderer/tree/actions.ts";
import {
  clearFilesTreeClipboard,
  writeFilesTreeClipboard,
} from "@plugins/builtin/files/renderer/tree/file-clipboard.ts";
import {
  createTreeCollapseFoldersAction,
  createTreeExpandAllAction,
} from "@plugins/builtin/files/renderer/tree/view-actions.ts";
import { registerGitReviewDiffActions } from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import {
  GIT_REVIEW_OPEN_FILE_COMMAND_ID,
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import type { Action } from "@/lib/actions/types.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { registerTerminalActions } from "@/panel-kits/terminal/register-actions.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function menuSketch(
  surface: string,
  invocation: {
    metadata?: Record<string, unknown>;
    sourcePanelId?: string;
    sourcePanelComponent?: string;
  } = {}
): Array<"|" | string> {
  return buildMenuEntries(surface, { ...invocation, surface }).map((entry) => {
    if (entry.type === "separator") {
      return "|";
    }
    if (entry.type === "action" || entry.type === "checkbox") {
      return entry.id;
    }
    return entry.type === "submenu" ? entry.label : entry.type;
  });
}

function firstAction(
  surface: string,
  invocation?: {
    metadata?: Record<string, unknown>;
    sourcePanelId?: string;
  }
): string | undefined {
  const first = menuSketch(surface, invocation).find((item) => item !== "|");
  return first;
}

function filesContext(): RendererPluginContext {
  return {
    actions: {
      register: (action: Action) => actionRegistry.register(action),
    },
    configuration: { get: () => undefined, set: async () => undefined },
    dialogs: {
      alert: async () => undefined,
      choice: async () => "cancel",
      confirm: async () => false,
      prompt: async () => null,
    },
    files: {
      exists: async () => ({ exists: false, path: "", root: "" }),
      reveal: async () => undefined,
    },
    i18n: {
      commandDescription: () => undefined,
      commandTitle: (_id: string, fallback?: string) => fallback ?? "",
      language: () => "en",
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
    notifications: {
      error: () => undefined,
      info: () => undefined,
      success: () => undefined,
    },
    panels: {
      getActiveContext: () => null,
      getActiveInstanceId: () => null,
      listInstances: () => [],
    },
  } as unknown as RendererPluginContext;
}

function registerPluginActions(actions: readonly { id: string }[]): void {
  for (const action of actions) {
    actionRegistry.register(action as Action);
  }
}

describe("context-menu order sketches", () => {
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    actionRegistry.clearForTests();
    writeMarkdownMeasureMode("comfortable");
    writeMarkdownReadingAppearance("auto");
    const files = filesContext();
    const controller = {} as FileEditorController;
    disposers.push(
      registerPanelActions(),
      registerTerminalActions(),
      registerRunActions(),
      registerGitReviewTreeActions(files),
      registerGitReviewDiffActions(files)
    );
    registerPluginActions([
      ...createFilesTreeActions(files, controller),
      ...createFilesEditorActions(files, controller),
      ...createFilesEditorPrefsActions(files),
      ...createFilesMarkdownPreviewActions(files, controller),
      ...createFilesSearchResultActions(files, controller),
      createSearchInFolderAction(files),
      createTreeExpandAllAction(files),
      createTreeCollapseFoldersAction(files),
    ]);
  });

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
    actionRegistry.clearForTests();
    useWorkspaceStore.getState().setApi(null);
    clearFilesTreeClipboard();
  });

  it("shows the visual first row for each popup surface", () => {
    expect(firstAction("panel/content")).toBe("pier.panel.copySelection");
    expect(
      firstAction("git/review-tree-item", {
        metadata: {
          contextId: "ctx",
          expectedIndexRevision: "index:1",
          gitRootPath: "/repo",
          hasUnstaged: true,
          kind: "file",
          path: "a.ts",
          repoPath: "a.ts",
          stagePaths: ["a.ts"],
          uncommitted: true,
        },
      })
    ).toBe("pier.git.review.stageFile");
    expect(
      firstAction("git/review-diff", {
        metadata: { contextId: "ctx", gitRootPath: "/repo", path: "a.ts" },
      })
    ).toBe("pier.panel.copySelection");
    expect(
      firstAction("files/tree-item", {
        metadata: { kind: "file", path: "a.ts", root: "/repo" },
      })
    ).toBe(FILES_NEW_FILE_COMMAND_ID);
    expect(
      firstAction("files/tree-background", {
        metadata: { root: "/repo" },
      })
    ).toBe(FILES_NEW_FILE_COMMAND_ID);
    expect(
      firstAction("files/search-result", {
        metadata: {
          line: 1,
          matchByteEnd: 1,
          matchByteStart: 0,
          matchCharEnd: 1,
          matchCharStart: 0,
          path: "a.ts",
          preview: "a",
          previewMatchEnd: 1,
          previewMatchStart: 0,
          root: "/repo",
        },
      })
    ).toBe(FILES_SEARCH_OPEN_HIT_COMMAND_ID);
    expect(
      firstAction("files/breadcrumb", {
        metadata: { path: "a.ts", root: "/repo" },
      })
    ).toBe(FILES_COPY_PATH_COMMAND_ID);
    expect(
      firstAction("files/editor", {
        metadata: {
          documentId: "doc",
          editorSessionId: "s",
          path: "a.ts",
          root: "/repo",
        },
      })
    ).toBe(FILES_EDITOR_CUT_COMMAND_ID);
    expect(
      firstAction("files/markdown-preview", {
        metadata: { path: "a.md", root: "/repo" },
      })
    ).toBe("pier.panel.copySelection");
    expect(
      firstAction("files/canvas-preview", {
        metadata: { path: "a.canvas.tsx", root: "/repo" },
      })
    ).toBe("pier.panel.copySelection");
    expect(firstAction("terminal/content")).toBe("pier.terminal.copy");
    expect(firstAction("terminal/restored")).toBe("pier.panel.copySelection");
  });

  it("sketches the review file row after git ops", () => {
    expect(
      menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, {
        metadata: {
          contextId: "ctx",
          expectedIndexRevision: "index:1",
          gitRootPath: "/repo",
          hasUnstaged: true,
          kind: "file",
          path: "a.ts",
          repoPath: "a.ts",
          stagePaths: ["a.ts"],
          unstagedStatus: "modified",
          uncommitted: true,
        },
      })
    ).toEqual([
      "pier.git.review.stageFile",
      "pier.git.review.discardFile",
      "|",
      GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      "pier.git.review.openDirectory",
      "|",
      "pier.git.review.copyPath",
      "pier.git.review.copyRelativePath",
      "pier.git.review.revealInFinder",
    ]);
  });

  it("sketches files tree file, directory, and background", () => {
    const fileMeta = { kind: "file" as const, path: "a.ts", root: "/repo" };
    const dirMeta = { kind: "directory" as const, path: "src", root: "/repo" };
    expect(menuSketch("files/tree-item", { metadata: fileMeta })).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
      FILES_RENAME_COMMAND_ID,
      FILES_DUPLICATE_COMMAND_ID,
      FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
      FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
      "|",
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
      "|",
      FILES_DELETE_COMMAND_ID,
    ]);
    expect(menuSketch("files/tree-item", { metadata: dirMeta })).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_TREE_EXPAND_ALL_COMMAND_ID,
      FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
      FILES_RENAME_COMMAND_ID,
      FILES_DUPLICATE_COMMAND_ID,
      FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
      FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
      "|",
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
      "|",
      FILES_DELETE_COMMAND_ID,
    ]);
    expect(
      menuSketch("files/tree-background", { metadata: { root: "/repo" } })
    ).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_TREE_EXPAND_ALL_COMMAND_ID,
      FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
    ]);
    writeFilesTreeClipboard({
      entries: [{ kind: "file", path: "a.ts" }],
      mode: "copy",
      root: "/repo",
    });
    expect(menuSketch("files/tree-item", { metadata: fileMeta })).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
      FILES_RENAME_COMMAND_ID,
      FILES_DUPLICATE_COMMAND_ID,
      FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
      FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
      FILES_FILE_CLIPBOARD_PASTE_COMMAND_ID,
      "|",
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
      "|",
      FILES_DELETE_COMMAND_ID,
    ]);
  });

  it("sketches search, breadcrumb, editor, and markdown preview", () => {
    const hit = {
      line: 1,
      matchByteEnd: 1,
      matchByteStart: 0,
      matchCharEnd: 1,
      matchCharStart: 0,
      path: "a.ts",
      preview: "a",
      previewMatchEnd: 1,
      previewMatchStart: 0,
      root: "/repo",
    };
    expect(menuSketch("files/search-result", { metadata: hit })).toEqual([
      FILES_SEARCH_OPEN_HIT_COMMAND_ID,
      "|",
      FILES_SEARCH_COPY_PATH_COMMAND_ID,
      FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_SEARCH_COPY_MATCH_COMMAND_ID,
      FILES_SEARCH_REVEAL_COMMAND_ID,
    ]);
    expect(
      menuSketch("files/breadcrumb", {
        metadata: { path: "a.ts", root: "/repo" },
      })
    ).toEqual([
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
    ]);
    expect(
      menuSketch("files/editor", {
        metadata: {
          documentId: "doc",
          editorSessionId: "s",
          path: "a.ts",
          root: "/repo",
        },
      })
    ).toEqual([
      FILES_EDITOR_CUT_COMMAND_ID,
      FILES_EDITOR_COPY_COMMAND_ID,
      FILES_EDITOR_PASTE_COMMAND_ID,
      FILES_EDITOR_SELECT_ALL_COMMAND_ID,
      "|",
      FILES_EDITOR_GO_TO_LINE_COMMAND_ID,
      FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
      FILES_EDITOR_SELECT_NEXT_OCCURRENCE_COMMAND_ID,
      FILES_EDITOR_SELECT_ALL_OCCURRENCES_COMMAND_ID,
      FILES_EDITOR_ADD_CURSOR_ABOVE_COMMAND_ID,
      FILES_EDITOR_ADD_CURSOR_BELOW_COMMAND_ID,
      "|",
      FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID,
      "|",
      FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
    ]);
    expect(
      menuSketch("files/markdown-preview", {
        metadata: { path: "a.md", root: "/repo" },
      }).slice(0, 8)
    ).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
      "|",
      FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
      FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
      "|",
    ]);
    expect(
      menuSketch("files/markdown-preview", {
        metadata: { path: "a.md", root: "/repo" },
      })
    ).not.toContain(FILES_COPY_PATH_COMMAND_ID);
    expect(
      menuSketch("files/editor", {
        metadata: {
          documentId: "doc",
          editorSessionId: "s",
          path: "a.ts",
          root: "/repo",
        },
      })
    ).not.toContain(FILES_COPY_PATH_COMMAND_ID);
  });

  it("leads a preview file tab with keep open before copy path", () => {
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "file-1",
        params: {
          pinned: false,
          source: { kind: "disk", path: "a.ts", root: "/repo" },
        },
        view: { contentComponent: "pier.files.filePanel" },
      },
      groups: [{ id: "g1", panels: [{ id: "file-1" }] }],
      panels: [
        {
          id: "file-1",
          params: {
            pinned: false,
            source: { kind: "disk", path: "a.ts", root: "/repo" },
          },
          view: { contentComponent: "pier.files.filePanel" },
        },
      ],
    } as never);
    const sketch = menuSketch("dockview-tab", { sourcePanelId: "file-1" });
    const keep = sketch.indexOf("pier.panel.keepOpen");
    const copy = sketch.indexOf("pier.panel.copyPath");
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(keep);
    expect(firstAction("dockview-tab", { sourcePanelId: "file-1" })).toBe(
      "pier.panel.keepOpen"
    );
  });
});
