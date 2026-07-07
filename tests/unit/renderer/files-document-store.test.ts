import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  markDocumentLoading,
  markDocumentSaved,
  markDocumentSaveError,
  removeDocument,
  restoreUntitledDocumentFromPanelSource,
  subscribeFilesDocumentStore,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import { parseFilesDocumentPanelSource } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { afterEach, describe, expect, it } from "vitest";

const FILE_DOCUMENT_ID_PATTERN = /^pier\.files\.file:[a-z0-9]+$/;

const terminalOrigin = {
  panelId: "terminal-1",
  source: "terminal-selection",
} as const;

describe("files-document-store", () => {
  afterEach(() => {
    clearFilesDocumentStore();
  });

  it("creates sequential untitled Markdown documents without embedding contents in the source", () => {
    const first = createUntitledMarkdownDocument({
      contents: "# Selection\n\nsecret-token",
      origin: terminalOrigin,
    });
    const second = createUntitledMarkdownDocument({ contents: "# Next" });

    expect(first.id).toBe("pier.files.untitled:1");
    expect(first.name).toBe("Untitled-1.md");
    expect(first.language).toBe("markdown");
    expect(first.capabilities).toEqual([]);
    expect(first.readOnly).toBe(false);
    expect(first.currentContents).toBe("# Selection\n\nsecret-token");
    expect(first.savedContents).toBe("# Selection\n\nsecret-token");
    expect(first.dirty).toBe(false);
    expect(first.loadState).toBe("loaded");
    expect(first.source.kind).toBe("untitled");
    if (first.source.kind === "untitled") {
      expect(first.source.id).toBe(first.id);
      expect(first.source.name).toBe(first.name);
      expect(first.source.language).toBe("markdown");
      expect(first.source.origin).toEqual(terminalOrigin);
      expect("initialContents" in first.source).toBe(false);
    }

    expect(second.id).toBe("pier.files.untitled:2");
    expect(second.name).toBe("Untitled-2.md");
  });

  it("pins the current document capability contract", () => {
    const temporary = createUntitledMarkdownDocument({ contents: "# Temp" });
    const disk = ensureDiskDocument({ path: "README.md", root: "/repo" });

    expect(disk.capabilities).toEqual(["save"]);
    expect(temporary.capabilities).toEqual([]);
    for (const document of [disk, temporary]) {
      expect(document.capabilities).not.toEqual(
        expect.arrayContaining(["delete", "move", "rename", "reveal", "saveAs"])
      );
    }
  });

  it("creates stable disk document shells without duplicating the same root and path", () => {
    const document = ensureDiskDocument({
      name: "README.md",
      path: "README.md",
      root: "/repo",
    });
    const duplicate = ensureDiskDocument({
      name: "Different name.md",
      path: "README.md",
      root: "/repo",
    });
    const differentSplit = ensureDiskDocument({
      path: "bc",
      root: "a",
    });
    const originalSplit = ensureDiskDocument({
      path: "c",
      root: "ab",
    });

    expect(document).toBe(duplicate);
    expect(document.id).toMatch(FILE_DOCUMENT_ID_PATTERN);
    expect(document.name).toBe("README.md");
    expect(document.language).toBe("markdown");
    expect(document.capabilities).toEqual(["save"]);
    expect(document.readOnly).toBe(false);
    expect(document.currentContents).toBe("");
    expect(document.savedContents).toBe("");
    expect(document.dirty).toBe(false);
    expect(document.loadState).toBe("idle");
    expect(document.error).toBeNull();
    expect(document.source).toEqual({
      kind: "disk",
      path: "README.md",
      root: "/repo",
    });
    expect(differentSplit.id).not.toBe(originalSplit.id);
  });

  it("restores the latest untitled Markdown draft from local persisted state", () => {
    const document = createUntitledMarkdownDocument({ contents: "# Initial" });
    updateDocumentContents(document.id, "# Edited before force quit");

    clearFilesDocumentStore({ persisted: false });
    const restored = restoreUntitledDocumentFromPanelSource({
      id: document.id,
      kind: "untitled",
      name: document.name,
    });

    expect(restored?.currentContents).toBe("# Edited before force quit");
    expect(restored?.dirty).toBe(true);
    expect(getDocument(document.id)?.currentContents).toBe(
      "# Edited before force quit"
    );
  });

  it("updates contents as dirty and markDocumentSaved syncs the saved buffer", () => {
    const document = ensureDiskDocument({ path: "notes.txt", root: "/repo" });

    updateDocumentContents(document.id, "draft");
    expect(getDocument(document.id)?.currentContents).toBe("draft");
    expect(getDocument(document.id)?.savedContents).toBe("");
    expect(getDocument(document.id)?.dirty).toBe(true);

    markDocumentSaved(document.id, "draft");
    expect(getDocument(document.id)?.savedContents).toBe("draft");
    expect(getDocument(document.id)?.dirty).toBe(false);
  });

  it("keeps dirty true when a save completes after newer edits", () => {
    const document = ensureDiskDocument({ path: "notes.txt", root: "/repo" });

    updateDocumentContents(document.id, "snapshot being saved");
    updateDocumentContents(document.id, "newer edit");
    markDocumentSaved(document.id, "snapshot being saved");

    expect(getDocument(document.id)?.savedContents).toBe(
      "snapshot being saved"
    );
    expect(getDocument(document.id)?.currentContents).toBe("newer edit");
    expect(getDocument(document.id)?.dirty).toBe(true);
  });

  it("records save errors without leaving loaded disk documents unsavable", () => {
    const document = ensureDiskDocument({ path: "notes.txt", root: "/repo" });

    updateDocumentContents(document.id, "draft");
    markDocumentSaveError(document.id, "disk full");

    expect(getDocument(document.id)?.error).toBe("disk full");
    expect(getDocument(document.id)?.loadState).toBe("loaded");
    expect(getDocument(document.id)?.dirty).toBe(true);
  });

  it("marks an idle disk document as loading synchronously only once", () => {
    const document = ensureDiskDocument({ path: "README.md", root: "/repo" });
    let notifications = 0;
    const unsubscribe = subscribeFilesDocumentStore(() => {
      notifications += 1;
    });

    markDocumentLoading(document.id);
    expect(getDocument(document.id)?.loadState).toBe("loading");
    expect(notifications).toBe(1);

    markDocumentLoading(document.id);
    expect(getDocument(document.id)?.loadState).toBe("loading");
    expect(notifications).toBe(1);

    unsubscribe();
  });

  it("removes untitled documents and releases terminal selection contents from the store", () => {
    const document = createUntitledMarkdownDocument({
      contents: "terminal selection secret",
      origin: terminalOrigin,
    });

    expect(getDocument(document.id)?.currentContents).toBe(
      "terminal selection secret"
    );
    const panelSource = {
      id: document.id,
      kind: "untitled" as const,
      name: document.name,
    };
    removeDocument(document.id);

    expect(getDocument(document.id)).toBeNull();
    clearFilesDocumentStore({ persisted: false });
    expect(restoreUntitledDocumentFromPanelSource(panelSource)).toBeNull();
  });

  it("clears all files documents on plugin deactivate", () => {
    const untitled = createUntitledMarkdownDocument({ contents: "secret" });
    const disk = ensureDiskDocument({ path: "README.md", root: "/repo" });

    clearFilesDocumentStore();

    expect(getDocument(untitled.id)).toBeNull();
    expect(getDocument(disk.id)).toBeNull();
  });

  it("notifies subscribers when documents change and stops after unsubscribe", () => {
    const document = createUntitledMarkdownDocument({ contents: "before" });
    let notifications = 0;
    const unsubscribe = subscribeFilesDocumentStore(() => {
      notifications += 1;
    });

    updateDocumentContents(document.id, "after");
    expect(notifications).toBe(1);

    unsubscribe();
    updateDocumentContents(document.id, "after unsubscribe");
    expect(notifications).toBe(1);
  });

  it("rebuilds a disk document shell from a disk panel source", () => {
    const panelSource = { kind: "disk", path: "src/index.ts", root: "/repo" };

    const document = ensureDiskDocument(panelSource);

    expect(document.source).toEqual(panelSource);
    expect(document.name).toBe("index.ts");
    expect(document.language).toBe("text");
    expect(document.loadState).toBe("idle");
  });

  it("parses untitled panel sources without carrying temporary contents", () => {
    const parsed = parseFilesDocumentPanelSource({
      source: {
        id: "pier.files.untitled:7",
        initialContents: "terminal selection secret",
        kind: "untitled",
        name: "Untitled-7.md",
      },
    });

    expect(parsed).toEqual({
      id: "pier.files.untitled:7",
      kind: "untitled",
      name: "Untitled-7.md",
    });
    expect(parsed && "initialContents" in parsed).toBe(false);
  });
});
