import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rendererDir = join(process.cwd(), "src/plugins/builtin/files/renderer");

function source(file: string): string {
  return readFileSync(join(rendererDir, file), "utf8");
}

describe("FileEditorController governance", () => {
  it("keeps EditorView construction and destruction outside React components", () => {
    const editorComponent = source("editor/cm.tsx");
    expect(editorComponent).not.toContain('from "codemirror"');
    expect(editorComponent).not.toContain("new EditorView");
    expect(editorComponent).not.toContain(".destroy()");

    const viewSession = source("editor/view-session.ts");
    expect(viewSession).toContain("new EditorView");
    expect(viewSession).toContain("view.destroy()");
  });

  it("keeps file IO, auto-save, and draft restoration out of React components", () => {
    const reactSources = [
      "editor/cm.tsx",
      "panel/actions.tsx",
      "panel/body.tsx",
      "panel/index.tsx",
      "panel/group-view.tsx",
    ]
      .map(source)
      .join("\n");
    expect(reactSources).not.toMatch(/\.files\.(readText|writeText|watch)\(/);
    expect(reactSources).not.toContain("configureFilesDraftBackend");
    expect(reactSources).not.toContain(
      "restoreUntitledDocumentFromPanelSource"
    );
    expect(source("panel/actions.tsx")).not.toContain("setTimeout(");
  });

  it("keeps pier.files on the revision-safe document IO contract", () => {
    const rendererSources = readdirSync(rendererDir, {
      encoding: "utf8",
      recursive: true,
    })
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .map(source)
      .join("\n");
    expect(rendererSources).not.toMatch(
      /(?:context|this\.#context)\.files\.(?:readText|writeText)\(/
    );
  });

  it("does not revive the whole-tree search loader", () => {
    expect(existsSync(join(rendererDir, "files-tree-search-loader.ts"))).toBe(
      false
    );
    expect(existsSync(join(rendererDir, "tree/search-loader.ts"))).toBe(false);
  });

  it("keeps the document store independent from React and CodeMirror", () => {
    const store = source("document/store.ts");
    expect(store).not.toMatch(/from ["']react["']/);
    expect(store).not.toMatch(/code-?mirror|codemirror/i);
  });

  it("keeps file-tree watching independent from open-document mutation", () => {
    const treeWatch = source("tree/watch.ts");
    const sidebarHelpers = source("tree/sidebar-helpers.ts");
    expect(treeWatch).not.toContain("files-document-store");
    expect(treeWatch).not.toContain("document/store");
    expect(treeWatch).not.toContain("markDocument");
    expect(treeWatch).toContain("watchHub.subscribe");
    expect(treeWatch).toContain("applyFilesTreeWatchEvent");
    expect(sidebarHelpers).toContain("ensureFilesTreeWatch");
  });

  it("routes production path mutations through the controller", () => {
    const sidebar = source("tree/sidebar.tsx");
    const treeActions = source("tree/actions.ts");
    const deleteAction = source("tree/delete-action.ts");
    const pluginEntry = source("index.tsx");
    expect(sidebar).not.toContain("files-document-store");
    expect(sidebar).toContain("controller.movePath");
    expect(treeActions).not.toContain("files-document-store");
    expect(deleteAction).not.toContain("files-document-store");
    expect(deleteAction).toContain(
      "controller.removeDocumentsAfterPathMutation"
    );
    expect(pluginEntry).toContain(
      "createFilesTreeActions(context, editorController)"
    );
  });

  it("creates one plugin-level editor controller", () => {
    const pluginEntry = source("index.tsx");
    expect(pluginEntry.match(/new FileEditorController\(/g)).toHaveLength(1);
    for (const component of [
      "editor/cm.tsx",
      "panel/index.tsx",
      "panel/group-view.tsx",
    ]) {
      expect(source(component), component).not.toContain(
        "new FileEditorController"
      );
    }
  });

  it("removes the legacy save and raw EditorView registries", () => {
    for (const file of [
      "file-panel-save.ts",
      "file-panel-save-registry.ts",
      "files-editor-view-registry.ts",
      "file-panel-hooks.ts",
      "panel/save.ts",
      "panel/save-registry.ts",
      "editor-view-registry.ts",
      "panel/hooks.ts",
    ]) {
      expect(existsSync(join(rendererDir, file)), file).toBe(false);
    }
    expect(source("editor/actions.ts")).not.toContain("EditorView");
  });
});
