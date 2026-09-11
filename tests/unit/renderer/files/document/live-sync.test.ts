import {
  handleDocumentStoreChangeForLiveSync,
  scheduleDocumentAutoSave,
} from "@plugins/builtin/files/renderer/document/live-sync.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  getDocument,
  markDocumentDeletedOnDisk,
  markDocumentReadResult,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/document/types.ts";
import { FILES_AUTO_SAVE_DELAY_MS } from "@plugins/builtin/files/settings.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function diskDocument(
  overrides: Partial<FilesDocument> & Pick<FilesDocument, "id">
): FilesDocument {
  return {
    baseMtimeMs: 1,
    canonicalPath: "note.md",
    capabilities: ["save", "saveAs"],
    conflictDiskContents: null,
    createdEmptyEol: null,
    currentContents: "# hi\n",
    deletedOnDisk: false,
    dirty: true,
    diskConflict: false,
    durabilityUnknown: false,
    eol: "lf",
    error: null,
    format: { bom: false, encoding: "utf8" },
    hasBackingStore: true,
    language: "markdown",
    loadState: "loaded",
    mime: null,
    mode: 0o644,
    name: "note.md",
    needsSaveAs: false,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: "r1",
    savedContents: "# hi\n",
    savedEol: "lf",
    savedFormat: { bom: false, encoding: "utf8" },
    saveState: "idle",
    size: 5,
    source: { kind: "disk", path: "note.md", root: "/repo" },
    ...overrides,
  };
}

function loadDiskNote(path = "note.md"): FilesDocument {
  const document = ensureDiskDocument({ path, root: "/repo" });
  markDocumentReadResult(document.id, {
    canonicalPath: path,
    contents: "# hi\n",
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mtimeMs: 1,
    mode: 0o644,
    path,
    revision: "r1",
    root: "/repo",
    size: 5,
    writable: true,
  });
  const loaded = getDocument(document.id);
  if (!loaded) {
    throw new Error("expected loaded disk document");
  }
  return loaded;
}

describe("scheduleDocumentAutoSave", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearFilesDocumentStore();
  });

  it("does not write while the open document is deleted on disk", () => {
    vi.useFakeTimers();
    const saveDocument = vi.fn(async () => undefined);
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    scheduleDocumentAutoSave({
      autoSaveEnabled: true,
      document: diskDocument({
        deletedOnDisk: true,
        hasBackingStore: false,
        id: "deleted-doc",
        revision: null,
      }),
      panelId: "panel-1",
      saveDocument,
      saveTimers,
      suspending: false,
    });
    vi.advanceTimersByTime(FILES_AUTO_SAVE_DELAY_MS + 50);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(saveTimers.size).toBe(0);
  });

  it("still schedules auto-save for a dirty disk document that exists", () => {
    vi.useFakeTimers();
    const saveDocument = vi.fn(async () => undefined);
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const document = loadDiskNote();
    updateDocumentContents(document.id, "# edited\n");
    const dirty = getDocument(document.id);
    if (!dirty) {
      throw new Error("expected dirty document");
    }
    scheduleDocumentAutoSave({
      autoSaveEnabled: true,
      document: dirty,
      panelId: "panel-1",
      saveDocument,
      saveTimers,
      suspending: false,
    });
    expect(saveTimers.size).toBe(1);
    vi.advanceTimersByTime(FILES_AUTO_SAVE_DELAY_MS + 50);
    expect(saveDocument).toHaveBeenCalledWith(document.id, "panel-1");
  });

  it("does not fire a pending timer after deletedOnDisk flips", () => {
    vi.useFakeTimers();
    const saveDocument = vi.fn(async () => undefined);
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const document = loadDiskNote();
    updateDocumentContents(document.id, "# edited\n");
    const dirty = getDocument(document.id);
    if (!dirty) {
      throw new Error("expected dirty document");
    }
    scheduleDocumentAutoSave({
      autoSaveEnabled: true,
      document: dirty,
      panelId: "panel-1",
      saveDocument,
      saveTimers,
      suspending: false,
    });
    expect(saveTimers.size).toBe(1);
    markDocumentDeletedOnDisk(document.id);
    vi.advanceTimersByTime(FILES_AUTO_SAVE_DELAY_MS + 50);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("clears a pending timer when the store marks the document deleted", () => {
    vi.useFakeTimers();
    const saveDocument = vi.fn(async () => undefined);
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const document = loadDiskNote();
    updateDocumentContents(document.id, "# edited\n");
    const dirty = getDocument(document.id);
    if (!dirty) {
      throw new Error("expected dirty document");
    }
    scheduleDocumentAutoSave({
      autoSaveEnabled: true,
      document: dirty,
      panelId: "panel-1",
      saveDocument,
      saveTimers,
      suspending: false,
    });
    markDocumentDeletedOnDisk(document.id);
    handleDocumentStoreChangeForLiveSync({
      autoSaveEnabled: true,
      lastContents: new Map([[document.id, dirty.currentContents]]),
      lastDirty: new Map([[document.id, true]]),
      loader: { start: vi.fn() },
      panelDocumentIds: new Set([document.id]),
      panelIdForDocument: () => "panel-1",
      saveDocument,
      saveTimers,
      suspending: false,
    });
    expect(saveTimers.size).toBe(0);
    vi.advanceTimersByTime(FILES_AUTO_SAVE_DELAY_MS + 50);
    expect(saveDocument).not.toHaveBeenCalled();
  });
});
