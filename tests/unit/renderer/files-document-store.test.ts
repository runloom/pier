import {
  createFileFilePanelInstanceId,
  fileFilePanelIdentityKey,
} from "@plugins/builtin/files/renderer/file-panel-id.ts";
import type { FilesDraftBackend } from "@plugins/builtin/files/renderer/files-document-drafts.ts";
import {
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  markDocumentLoaded,
  markDocumentLoading,
  markDocumentSaved,
  markDocumentSaveError,
  moveDiskDocumentSource,
  removeDiskDocumentForPath,
  removeDocument,
  resetFilesDraftBackendForTests,
  restoreUntitledDocumentFromPanelSource,
  subscribeFilesDocumentStore,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "@plugins/builtin/files/renderer/files-document-types.ts";
import { stableFileIdentityHash } from "@plugins/builtin/files/renderer/files-stable-hash.ts";
import { afterEach, describe, expect, it } from "vitest";

const FILE_DOCUMENT_ID_PATTERN = /^pier\.files\.file:[a-z0-9]+$/;

const terminalOrigin = {
  panelId: "terminal-1",
  source: "terminal-selection",
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function diskDraftKey(root: string, path: string): string {
  return `pier.files.diskDraft:${stableFileIdentityHash(`${root}\0${path}`)}`;
}

function untitledDraftKey(documentId: string): string {
  return `pier.files.untitledDraft:${documentId}`;
}

describe("files-document-store", () => {
  afterEach(() => {
    clearFilesDocumentStore();
    resetFilesDraftBackendForTests();
    globalThis.localStorage?.clear();
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

  it("uses stable identity keys for file panels while creating distinct tab instance ids", () => {
    const source = {
      kind: "disk" as const,
      path: "notes/𝌆-😀.md",
      root: "/repo/🚀",
    };

    const document = ensureDiskDocument(source);
    const identityKey = fileFilePanelIdentityKey(source);
    const firstInstanceId = createFileFilePanelInstanceId(source, "tab-a");
    const secondInstanceId = createFileFilePanelInstanceId(source, "tab-b");

    expect(identityKey.replace("pier.files.filePanel:disk:", "")).toBe(
      document.id.replace("pier.files.file:", "")
    );
    expect(firstInstanceId).toBe(`${identityKey}:tab-a`);
    expect(secondInstanceId).toBe(`${identityKey}:tab-b`);
    expect(firstInstanceId).not.toBe(secondInstanceId);
  });

  it("compares file panel sources by document identity", () => {
    expect(
      sameFilesDocumentPanelSource(
        { kind: "disk", path: "README.md", root: "/repo" },
        { kind: "disk", path: "README.md", root: "/repo" }
      )
    ).toBe(true);
    expect(
      sameFilesDocumentPanelSource(
        { kind: "disk", path: "README.md", root: "/repo-a" },
        { kind: "disk", path: "README.md", root: "/repo-b" }
      )
    ).toBe(false);
    expect(
      sameFilesDocumentPanelSource(
        { id: "pier.files.untitled:1", kind: "untitled", name: "Draft.md" },
        { id: "pier.files.untitled:1", kind: "untitled", name: "Renamed.md" }
      )
    ).toBe(true);
    expect(
      sameFilesDocumentPanelSource(
        { id: "pier.files.untitled:1", kind: "untitled", name: "Draft.md" },
        { id: "pier.files.untitled:2", kind: "untitled", name: "Draft.md" }
      )
    ).toBe(false);
  });

  it("moves a dirty disk document to the new canonical path while keeping old aliases readable", () => {
    const root = "/repo";
    const oldSource = { kind: "disk" as const, path: "drafts/old.md", root };
    const newSource = { kind: "disk" as const, path: "published/new.md", root };
    const document = ensureDiskDocument(oldSource);
    markDocumentSaved(document.id, "saved on disk");
    updateDocumentContents(document.id, "unsaved rename draft");

    moveDiskDocumentSource(root, oldSource.path, newSource.path);

    const canonical = getDocumentForPanelSource(newSource);
    expect(canonical?.id).not.toBe(document.id);
    expect(canonical?.currentContents).toBe("unsaved rename draft");
    expect(canonical?.dirty).toBe(true);
    expect(canonical?.name).toBe("new.md");
    expect(canonical?.savedContents).toBe("saved on disk");
    expect(canonical?.source).toEqual(newSource);
    expect(getDocument(document.id)).toBe(canonical);
    expect(getDocumentForPanelSource(oldSource)).toBe(canonical);
    expect(ensureDiskDocument(newSource)).toBe(canonical);
  });

  it("removes both the moved document and its previous path alias", () => {
    const root = "/repo";
    const oldSource = { kind: "disk" as const, path: "drafts/old.md", root };
    const newSource = { kind: "disk" as const, path: "published/new.md", root };
    const document = ensureDiskDocument(oldSource);
    moveDiskDocumentSource(root, oldSource.path, newSource.path);
    const moved = getDocumentForPanelSource(newSource);
    expect(moved).not.toBeNull();

    removeDiskDocumentForPath(root, newSource.path);

    expect(getDocument(document.id)).toBeNull();
    expect(getDocument(moved?.id ?? "")).toBeNull();
    expect(getDocumentForPanelSource(oldSource)).toBeNull();
    expect(getDocumentForPanelSource(newSource)).toBeNull();
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

  it("hydrates backend-only drafts into panels restored before draft backend resolves", async () => {
    const root = "/repo";
    const path = "notes.md";
    const untitledId = "pier.files.untitled:7";
    const pendingDrafts = deferred<Record<string, string>>();
    const backend: FilesDraftBackend = {
      delete: async () => undefined,
      list: () => pendingDrafts.promise,
      set: async () => undefined,
    };

    const hydration = configureFilesDraftBackend(backend);
    const diskDocument = ensureDiskDocument({ path, root });
    const missingUntitled = restoreUntitledDocumentFromPanelSource({
      id: untitledId,
      kind: "untitled",
      name: "Untitled-7.md",
    });

    expect(diskDocument.dirty).toBe(false);
    expect(missingUntitled).toBeNull();

    pendingDrafts.resolve({
      [diskDraftKey(root, path)]: JSON.stringify({
        baseMtimeMs: 123,
        currentContents: "# backend disk draft",
        id: diskDocument.id,
        path,
        root,
        savedContents: "# disk baseline",
      }),
      [untitledDraftKey(untitledId)]: JSON.stringify({
        currentContents: "# backend untitled draft",
        dirty: true,
        id: untitledId,
        name: "Untitled-7.md",
        savedContents: "# untitled baseline",
      }),
    });
    await hydration;

    const hydratedDiskDocument = getDocument(diskDocument.id);
    expect(hydratedDiskDocument?.currentContents).toBe("# backend disk draft");
    expect(hydratedDiskDocument?.savedContents).toBe("# disk baseline");
    expect(hydratedDiskDocument?.baseMtimeMs).toBe(123);
    expect(hydratedDiskDocument?.dirty).toBe(true);
    expect(hydratedDiskDocument?.loadState).toBe("loaded");

    const hydratedUntitledDocument = getDocument(untitledId);
    expect(hydratedUntitledDocument?.currentContents).toBe(
      "# backend untitled draft"
    );
    expect(hydratedUntitledDocument?.dirty).toBe(true);
  });

  it("keeps a hydrated dirty disk draft when a delayed disk read completes", async () => {
    const root = "/repo";
    const path = "delayed.md";
    const pendingDrafts = deferred<Record<string, string>>();
    const backend: FilesDraftBackend = {
      delete: async () => undefined,
      list: () => pendingDrafts.promise,
      set: async () => undefined,
    };

    const hydration = configureFilesDraftBackend(backend);
    const document = ensureDiskDocument({ path, root });
    markDocumentLoading(document.id);
    pendingDrafts.resolve({
      [diskDraftKey(root, path)]: JSON.stringify({
        baseMtimeMs: 123,
        currentContents: "# draft should win",
        id: document.id,
        path,
        root,
        savedContents: "# disk baseline",
      }),
    });
    await hydration;

    markDocumentLoaded(document.id, "# delayed disk contents", 456);

    expect(getDocument(document.id)?.currentContents).toBe(
      "# draft should win"
    );
    expect(getDocument(document.id)?.savedContents).toBe("# disk baseline");
    expect(getDocument(document.id)?.dirty).toBe(true);
  });

  it("falls back to local draft storage when draft backend hydration fails", async () => {
    const root = "/repo";
    const path = "fallback.md";
    const backend: FilesDraftBackend = {
      delete: async () => undefined,
      list: () => Promise.reject(new Error("draft backend unavailable")),
      set: async () => undefined,
    };

    await configureFilesDraftBackend(backend);
    const document = ensureDiskDocument({ path, root });
    markDocumentLoaded(document.id, "# disk baseline", 123);
    updateDocumentContents(document.id, "# local fallback draft");

    clearFilesDocumentStore({ persisted: false });
    resetFilesDraftBackendForTests();
    const restored = ensureDiskDocument({ path, root });

    expect(restored.currentContents).toBe("# local fallback draft");
    expect(restored.savedContents).toBe("# disk baseline");
    expect(restored.dirty).toBe(true);
  });

  it("keeps a local disk draft backup when configured draft backend writes fail", async () => {
    const root = "/repo";
    const path = "backend-write-fallback.md";
    const failingSetBackend: FilesDraftBackend = {
      delete: async () => undefined,
      list: async () => ({}),
      set: () => Promise.reject(new Error("draft backend write failed")),
    };

    await configureFilesDraftBackend(failingSetBackend);
    const document = ensureDiskDocument({ path, root });
    markDocumentLoaded(document.id, "# disk baseline", 123);
    updateDocumentContents(document.id, "# local backup draft");
    await Promise.resolve();

    clearFilesDocumentStore({ persisted: false });
    resetFilesDraftBackendForTests();
    await configureFilesDraftBackend({
      delete: async () => undefined,
      list: async () => ({}),
      set: async () => undefined,
    });
    const restored = ensureDiskDocument({ path, root });

    expect(restored.currentContents).toBe("# local backup draft");
    expect(restored.savedContents).toBe("# disk baseline");
    expect(restored.dirty).toBe(true);
  });

  it("keeps a local disk draft tombstone when configured draft backend deletes fail", async () => {
    const root = "/repo";
    const path = "backend-delete-fallback.md";
    const persisted = new Map<string, string>();
    const backend: FilesDraftBackend = {
      delete: () => Promise.reject(new Error("draft backend delete failed")),
      list: () => Promise.resolve(Object.fromEntries(persisted)),
      set: (key, value) => {
        persisted.set(key, value);
        return Promise.resolve();
      },
    };

    await configureFilesDraftBackend(backend);
    const document = ensureDiskDocument({ path, root });
    markDocumentLoaded(document.id, "# disk baseline", 123);
    updateDocumentContents(document.id, "# stale draft");
    await Promise.resolve();

    removeDocument(document.id);
    await Promise.resolve();
    clearFilesDocumentStore({ persisted: false });
    resetFilesDraftBackendForTests();
    await configureFilesDraftBackend({
      delete: (key) => {
        persisted.delete(key);
        return Promise.resolve();
      },
      list: () => Promise.resolve(Object.fromEntries(persisted)),
      set: (key, value) => {
        persisted.set(key, value);
        return Promise.resolve();
      },
    });
    const restored = ensureDiskDocument({ path, root });

    expect(restored.currentContents).toBe("");
    expect(restored.dirty).toBe(false);
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

  it("infers CodeMirror-supported language ids from file extensions", () => {
    // TypeScript / TSX 走 lang-javascript typescript+jsx flag,与 markdown /
    // legacy stream mode(swift/toml)一起构成 languageForPath 的三种典型分支。
    const ts = ensureDiskDocument({
      path: "src/index.ts",
      root: "/repo",
    });
    expect(ts.language).toBe("typescript");
    expect(ts.name).toBe("index.ts");

    const swift = ensureDiskDocument({
      path: "native/Package.swift",
      root: "/repo",
    });
    expect(swift.language).toBe("swift");

    const markdown = ensureDiskDocument({
      path: "README.md",
      root: "/repo",
    });
    expect(markdown.language).toBe("markdown");

    // 无扩展名 → text 兜底,不会 crash 语言解析。
    const unknown = ensureDiskDocument({
      path: "Makefile",
      root: "/repo",
    });
    expect(unknown.language).toBe("text");
  });

  it("rebuilds a disk document shell from a disk panel source", () => {
    const panelSource = { kind: "disk", path: "src/index.ts", root: "/repo" };

    const document = ensureDiskDocument(panelSource);

    expect(document.source).toEqual(panelSource);
    expect(document.name).toBe("index.ts");
    expect(document.language).toBe("typescript");
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

  it("cascades directory moves and deletes to open child documents", () => {
    const root = "/repo";
    const nested = ensureDiskDocument({ path: "docs/a/note.md", root });
    const sibling = ensureDiskDocument({ path: "docs/b.md", root });
    updateDocumentContents(nested.id, "nested draft");

    moveDiskDocumentSource(root, "docs", "guides");

    expect(
      getDocumentForPanelSource({
        kind: "disk",
        path: "guides/a/note.md",
        root,
      })?.currentContents
    ).toBe("nested draft");
    expect(
      getDocumentForPanelSource({ kind: "disk", path: "guides/b.md", root })
    ).not.toBeNull();
    expect(
      getDocumentForPanelSource({ kind: "disk", path: "docs/a/note.md", root })
    ).toBe(
      getDocumentForPanelSource({
        kind: "disk",
        path: "guides/a/note.md",
        root,
      })
    );

    removeDiskDocumentForPath(root, "guides");
    expect(getDocument(nested.id)).toBeNull();
    expect(getDocument(sibling.id)).toBeNull();
  });

  it("restores dirty disk drafts after an in-memory store clear", () => {
    const document = ensureDiskDocument({ path: "README.md", root: "/repo" });
    updateDocumentContents(document.id, "# dirty draft");

    clearFilesDocumentStore({ persisted: false });
    const restored = ensureDiskDocument({ path: "README.md", root: "/repo" });
    expect(restored.currentContents).toBe("# dirty draft");
    expect(restored.dirty).toBe(true);
    expect(restored.loadState).toBe("loaded");
  });
});
