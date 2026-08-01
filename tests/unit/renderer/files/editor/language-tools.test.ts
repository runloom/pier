import type { Extension } from "@codemirror/state";
import type { FilesDocument } from "@plugins/builtin/files/renderer/document/types.ts";
import { FileEditorLanguageTools } from "@plugins/builtin/files/renderer/editor/language-tools.ts";
import type { FilesEditorPrefs } from "@plugins/builtin/files/renderer/editor/prefs.ts";
import type * as FilesLspClientModule from "@plugins/builtin/files/renderer/lsp/client.ts";
import {
  getFilesLanguageServiceStatus,
  publishFilesLanguageServiceStatus,
  resetFilesLanguageServiceStatusForTests,
  subscribeFilesLanguageServiceStatus,
} from "@plugins/builtin/files/renderer/panel/language-service-status.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface DelegatedLspInput {
  absolutePath: string;
  documentId: string;
  getOpenExternal: () => (url: string) => void;
  ownerId: string;
  rootPath: string;
}

const lspExtensions = vi.hoisted(() => vi.fn());

vi.mock(
  "@plugins/builtin/files/renderer/lsp/client.ts",
  async (importOriginal) => {
    const actual = await importOriginal<typeof FilesLspClientModule>();
    return {
      ...actual,
      filesLspEditorExtensions: lspExtensions,
    };
  }
);

const enabledPrefs: FilesEditorPrefs = {
  defaultLanguage: null,
  lspEnabled: true,
  tabSize: 2,
  wordWrap: false,
};

const openExternal = () => undefined;
const getOpenExternal = () => openExternal;

function createLanguageTools(ownerId: string, prefs: FilesEditorPrefs) {
  return new FileEditorLanguageTools({ getOpenExternal, ownerId, prefs });
}

function createDiskDocument(id = "document-1"): FilesDocument {
  return {
    baseMtimeMs: 1,
    canonicalPath: "/repo/src/file.ts",
    capabilities: ["save"],
    conflictDiskContents: null,
    createdEmptyEol: null,
    currentContents: "const value = 1;\n",
    deletedOnDisk: false,
    dirty: false,
    diskConflict: false,
    durabilityUnknown: false,
    eol: "lf",
    error: null,
    format: { bom: false, encoding: "utf8" },
    hasBackingStore: true,
    id,
    language: "typescript",
    loadState: "loaded",
    mime: null,
    mode: 0o644,
    name: "file.ts",
    needsSaveAs: false,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: "revision-1",
    savedContents: "const value = 1;\n",
    saveState: "idle",
    size: 17,
    source: { kind: "disk", path: "src/file.ts", root: "/repo" },
  };
}

function createUntitledDocument(id = "untitled-1"): FilesDocument {
  return {
    ...createDiskDocument(id),
    canonicalPath: null,
    capabilities: ["saveAs"],
    hasBackingStore: false,
    name: "Untitled-1",
    needsSaveAs: true,
    source: {
      id,
      kind: "untitled",
      language: "typescript",
      name: "Untitled-1",
    },
  };
}

describe("FileEditorLanguageTools status ownership", () => {
  beforeEach(() => {
    resetFilesLanguageServiceStatusForTests();
    lspExtensions.mockReset();
    lspExtensions.mockImplementation((input: DelegatedLspInput): Extension => {
      publishFilesLanguageServiceStatus(input.ownerId, input.documentId, {
        state: "starting",
      });
      return [];
    });
  });

  it("publishes editor-disabled before returning without an LSP extension", () => {
    const tools = createLanguageTools("editor-session-1", {
      ...enabledPrefs,
      lspEnabled: false,
    });

    tools.extensions(createDiskDocument());

    expect(
      getFilesLanguageServiceStatus("editor-session-1", "document-1")
    ).toEqual({ state: "disabled", reason: "editor-disabled" });
    expect(lspExtensions).not.toHaveBeenCalled();
  });

  it("publishes unsupported non-disk status for an untitled document", () => {
    const tools = createLanguageTools("editor-session-1", enabledPrefs);

    tools.extensions(createUntitledDocument());

    expect(
      getFilesLanguageServiceStatus("editor-session-1", "untitled-1")
    ).toEqual({ state: "unsupported", reason: "non-disk" });
    expect(lspExtensions).not.toHaveBeenCalled();
  });

  it("delegates disk status publication with editorSessionId as ownerId", () => {
    const tools = createLanguageTools("editor-session-1", enabledPrefs);

    tools.extensions(createDiskDocument());

    expect(lspExtensions).toHaveBeenCalledOnce();
    expect(lspExtensions).toHaveBeenCalledWith({
      absolutePath: "/repo/src/file.ts",
      documentId: "document-1",
      getOpenExternal,
      ownerId: "editor-session-1",
      rootPath: "/repo",
    });
    expect(
      getFilesLanguageServiceStatus("editor-session-1", "document-1")
    ).toEqual({ state: "starting" });
  });

  it("clears the replaced document key before publishing its replacement", () => {
    const ownerId = "editor-session-1";
    const oldDocument = createUntitledDocument("untitled-old");
    const newDocument = createUntitledDocument("untitled-new");
    const tools = createLanguageTools(ownerId, enabledPrefs);
    tools.extensions(oldDocument);

    let observedReplacement = false;
    const unsubscribe = subscribeFilesLanguageServiceStatus(() => {
      const replacement = getFilesLanguageServiceStatus(
        ownerId,
        newDocument.id
      );
      if (replacement) {
        expect(
          getFilesLanguageServiceStatus(ownerId, oldDocument.id)
        ).toBeNull();
        observedReplacement = true;
      }
    });

    tools.syncDocument(newDocument);
    tools.commitPendingStatus();
    unsubscribe();

    expect(observedReplacement).toBe(true);
    expect(getFilesLanguageServiceStatus(ownerId, oldDocument.id)).toBeNull();
    expect(getFilesLanguageServiceStatus(ownerId, newDocument.id)).toEqual({
      state: "unsupported",
      reason: "non-disk",
    });
  });

  it("keeps two editorSessionIds isolated for the same document", () => {
    const sharedDocument = createDiskDocument("shared-document");
    const disabledTools = createLanguageTools("editor-session-disabled", {
      ...enabledPrefs,
      lspEnabled: false,
    });
    const enabledTools = createLanguageTools(
      "editor-session-enabled",
      enabledPrefs
    );

    disabledTools.extensions(sharedDocument);
    enabledTools.extensions(sharedDocument);

    expect(
      getFilesLanguageServiceStatus(
        "editor-session-disabled",
        sharedDocument.id
      )
    ).toEqual({ state: "disabled", reason: "editor-disabled" });
    expect(
      getFilesLanguageServiceStatus("editor-session-enabled", sharedDocument.id)
    ).toEqual({ state: "starting" });
  });
});
