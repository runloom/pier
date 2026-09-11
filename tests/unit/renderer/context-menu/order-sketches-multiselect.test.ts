import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_COMMAND_ID,
  FILES_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_DELETE_COMMAND_ID,
  FILES_DUPLICATE_COMMAND_ID,
  FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
  FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
  FILES_FILE_CLIPBOARD_PASTE_COMMAND_ID,
  FILES_NEW_FILE_COMMAND_ID,
  FILES_NEW_FOLDER_COMMAND_ID,
  FILES_OPEN_DIRECTORY_COMMAND_ID,
  FILES_RENAME_COMMAND_ID,
  FILES_REVEAL_COMMAND_ID,
  FILES_SEARCH_IN_FOLDER_COMMAND_ID,
  FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
  FILES_TREE_EXPAND_ALL_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { createSearchInFolderAction } from "@plugins/builtin/files/renderer/search/actions.ts";
import { createFilesTreeActions } from "@plugins/builtin/files/renderer/tree/actions.ts";
import {
  clearFilesTreeClipboard,
  writeFilesTreeClipboard,
} from "@plugins/builtin/files/renderer/tree/file-clipboard.ts";
import {
  createTreeCollapseFoldersAction,
  createTreeExpandAllAction,
} from "@plugins/builtin/files/renderer/tree/view-actions.ts";
import {
  GIT_REVIEW_OPEN_FILE_COMMAND_ID,
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

function interpolate(
  template: string,
  values?: Record<string, number | string>
): string {
  if (!values) {
    return template;
  }
  return Object.entries(values).reduce(
    (message, [name, value]) =>
      message.replaceAll(`{{${name}}}`, String(value)),
    template
  );
}

function menuSketch(
  surface: string,
  metadata: Record<string, unknown>
): Array<"|" | string> {
  return buildMenuEntries(surface, { metadata, surface }).map((entry) => {
    if (entry.type === "separator") {
      return "|";
    }
    if (entry.type === "action" || entry.type === "checkbox") {
      return entry.id;
    }
    return entry.type === "submenu" ? entry.label : entry.type;
  });
}

function menuLabels(
  surface: string,
  metadata: Record<string, unknown>
): string[] {
  return buildMenuEntries(surface, { metadata, surface }).flatMap((entry) =>
    entry.type === "action" || entry.type === "checkbox" ? [entry.label] : []
  );
}

function firstAction(
  surface: string,
  metadata: Record<string, unknown>
): string | undefined {
  return menuSketch(surface, metadata).find((item) => item !== "|");
}

describe("context-menu multi-select sketches", () => {
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    actionRegistry.clearForTests();
    const context = {
      actions: {
        register: (action: Action) => actionRegistry.register(action),
      },
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
        t: (
          _key: string,
          values?: Record<string, number | string>,
          fallback?: string
        ) => interpolate(fallback ?? _key, values),
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
    const controller = {} as FileEditorController;
    disposers.push(registerGitReviewTreeActions(context));
    for (const action of [
      ...createFilesTreeActions(context, controller),
      createSearchInFolderAction(context),
      createTreeExpandAllAction(context),
      createTreeCollapseFoldersAction(context),
    ]) {
      actionRegistry.register(action as Action);
    }
  });

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
    actionRegistry.clearForTests();
    clearFilesTreeClipboard();
  });

  it("keeps Files new-file first and hides rename/duplicate", () => {
    const fileMeta = {
      kind: "file",
      path: "a.ts",
      root: "/repo",
      selectedPaths: ["a.ts", "b.ts"],
    };
    expect(firstAction("files/tree-item", fileMeta)).toBe(
      FILES_NEW_FILE_COMMAND_ID
    );
    expect(menuSketch("files/tree-item", fileMeta)).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
      FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
      FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
      "|",
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
      "|",
      FILES_DELETE_COMMAND_ID,
    ]);
    expect(menuSketch("files/tree-item", fileMeta)).not.toContain(
      FILES_RENAME_COMMAND_ID
    );
    expect(menuSketch("files/tree-item", fileMeta)).not.toContain(
      FILES_DUPLICATE_COMMAND_ID
    );
    expect(menuSketch("files/tree-item", fileMeta)).not.toContain(
      FILES_OPEN_DIRECTORY_COMMAND_ID
    );
    expect(menuLabels("files/tree-item", fileMeta)).toEqual([
      "New File...",
      "New Folder...",
      "Find in Folder…",
      "Cut",
      "Copy",
      "Copy Path",
      "Copy Relative Path",
      "Reveal in Finder",
      "Delete (2)",
    ]);
  });

  it("keeps expand/collapse on a multi-selected directory", () => {
    const dirMeta = {
      kind: "directory",
      path: "src",
      root: "/repo",
      selectedPaths: ["src", "lib"],
    };
    expect(menuSketch("files/tree-item", dirMeta)).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_TREE_EXPAND_ALL_COMMAND_ID,
      FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
      FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
      FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
      "|",
      FILES_COPY_PATH_COMMAND_ID,
      FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      FILES_REVEAL_COMMAND_ID,
      "|",
      FILES_DELETE_COMMAND_ID,
    ]);
    expect(menuLabels("files/tree-item", dirMeta)).toContain("Delete (2)");
  });

  it("keeps paste on the same skeleton when the tree clipboard has content", () => {
    writeFilesTreeClipboard({
      entries: [{ kind: "file", path: "x.ts" }],
      mode: "copy",
      root: "/repo",
    });
    const fileMeta = {
      kind: "file",
      path: "a.ts",
      root: "/repo",
      selectedPaths: ["a.ts", "b.ts"],
    };
    expect(menuSketch("files/tree-item", fileMeta)).toEqual([
      FILES_NEW_FILE_COMMAND_ID,
      FILES_NEW_FOLDER_COMMAND_ID,
      "|",
      FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      "|",
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
    expect(menuLabels("files/tree-item", fileMeta)).toContain("Paste");
    expect(menuLabels("files/tree-item", fileMeta)).not.toContain("Cut (2)");
  });

  it("keeps rename on Inspect when the click target is outside L-Select", () => {
    const inspect = {
      kind: "file",
      path: "a.ts",
      root: "/repo",
      selectedPaths: ["b.ts", "c.ts"],
    };
    expect(menuSketch("files/tree-item", inspect)).toContain(
      FILES_RENAME_COMMAND_ID
    );
    expect(menuSketch("files/tree-item", inspect)).toContain(
      FILES_DUPLICATE_COMMAND_ID
    );
    expect(menuLabels("files/tree-item", inspect)).toContain("Delete");
    expect(menuLabels("files/tree-item", inspect)).not.toContain("Delete (2)");
  });

  it("keeps review stage first and hides open directory", () => {
    const unstaged = {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasUnstaged: true,
      kind: "file",
      path: "a.ts",
      repoPath: "a.ts",
      selectedPaths: ["a.ts", "b.ts"],
      stagePaths: ["a.ts", "b.ts"],
      discardTrackedPaths: ["a.ts", "b.ts"],
      unstagedStatus: "modified",
      uncommitted: true,
    };
    expect(firstAction(GIT_REVIEW_TREE_ITEM_SURFACE, unstaged)).toBe(
      "pier.git.review.stageFile"
    );
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, unstaged)).toEqual([
      "pier.git.review.stageFile",
      "pier.git.review.discardFile",
      "|",
      GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      "|",
      "pier.git.review.copyPath",
      "pier.git.review.copyRelativePath",
      "pier.git.review.revealInFinder",
    ]);
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, unstaged)).not.toContain(
      "pier.git.review.openDirectory"
    );
    expect(menuLabels(GIT_REVIEW_TREE_ITEM_SURFACE, unstaged)).toEqual([
      "Stage (2)",
      "Discard Changes (2)",
      "Open File",
      "Copy Path",
      "Copy Relative Path",
      "Reveal in Finder",
    ]);
  });

  it("shows stage and unstage together for a mixed review selection", () => {
    const mixed = {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasStaged: true,
      hasUnstaged: true,
      kind: "file",
      path: "a.ts",
      repoPath: "a.ts",
      selectedPaths: ["a.ts", "b.ts"],
      stagePaths: ["a.ts"],
      unstagePaths: ["b.ts"],
      discardTrackedPaths: ["a.ts"],
      unstagedStatus: "modified",
      uncommitted: true,
    };
    expect(firstAction(GIT_REVIEW_TREE_ITEM_SURFACE, mixed)).toBe(
      "pier.git.review.stageFile"
    );
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, mixed)).toEqual([
      "pier.git.review.stageFile",
      "pier.git.review.unstageFile",
      "pier.git.review.discardFile",
      "|",
      GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      "|",
      "pier.git.review.copyPath",
      "pier.git.review.copyRelativePath",
      "pier.git.review.revealInFinder",
    ]);
    expect(menuLabels(GIT_REVIEW_TREE_ITEM_SURFACE, mixed)).toEqual([
      "Stage",
      "Unstage",
      "Discard Changes",
      "Open File",
      "Copy Path",
      "Copy Relative Path",
      "Reveal in Finder",
    ]);
  });

  it("keeps stage when the selection also contains a conflict", () => {
    const mixedConflict = {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasConflict: true,
      hasUnstaged: true,
      kind: "file",
      path: "a.ts",
      repoPath: "a.ts",
      selectedPaths: ["a.ts", "c.ts"],
      stagePaths: ["a.ts"],
      discardTrackedPaths: ["a.ts"],
      unstagedStatus: "modified",
      uncommitted: true,
    };
    expect(firstAction(GIT_REVIEW_TREE_ITEM_SURFACE, mixedConflict)).toBe(
      "pier.git.review.stageFile"
    );
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, mixedConflict)).toContain(
      "pier.git.review.stageFile"
    );
    expect(menuLabels(GIT_REVIEW_TREE_ITEM_SURFACE, mixedConflict)).toContain(
      "Stage"
    );
  });

  it("hides stage when a multi-select is only conflicts", () => {
    const conflictsOnly = {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasConflict: true,
      kind: "file",
      path: "c.ts",
      repoPath: "c.ts",
      selectedPaths: ["c.ts", "d.ts"],
      uncommitted: true,
    };
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, conflictsOnly)).toEqual([
      GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      "|",
      "pier.git.review.copyPath",
      "pier.git.review.copyRelativePath",
      "pier.git.review.revealInFinder",
    ]);
  });

  it("shows open directory on Inspect when the click is outside L-Select", () => {
    const inspect = {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasUnstaged: true,
      kind: "file",
      path: "a.ts",
      repoPath: "a.ts",
      selectedPaths: ["b.ts", "c.ts"],
      stagePaths: ["a.ts"],
      unstagedStatus: "modified",
      uncommitted: true,
    };
    expect(menuSketch(GIT_REVIEW_TREE_ITEM_SURFACE, inspect)).toContain(
      "pier.git.review.openDirectory"
    );
    expect(menuLabels(GIT_REVIEW_TREE_ITEM_SURFACE, inspect)).toContain(
      "Stage"
    );
    expect(menuLabels(GIT_REVIEW_TREE_ITEM_SURFACE, inspect)).not.toContain(
      "Stage (2)"
    );
  });
});
