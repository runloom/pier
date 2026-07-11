import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileEditorController } from "@plugins/builtin/files/renderer/file-editor-controller.ts";
import { flushFilesDraftWrites } from "@plugins/builtin/files/renderer/files-document-drafts.ts";
import {
  clearFilesDocumentStore,
  getDocument,
  resetFilesDraftBackendForTests,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import type { FilesDocumentPanelSource } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { FilesWatchHub } from "@plugins/builtin/files/renderer/files-watch-hub.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/repo";
const SOURCE = { kind: "disk" as const, path: "README.md", root: ROOT };
interface WriteResult {
  mtimeMs: number;
  path: string;
  root: string;
  written: true;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  options: {
    autoSave?: boolean;
    conflictChoice?: "alt" | "cancel" | "confirm";
    draftDiagnostics?: Array<{
      id: string;
      message: string;
      quarantinedAt: number;
    }>;
    draftListFailures?: number;
    draftValues?: Map<string, string>;
    durability?: "confirmed" | "unknown";
    panelSource?: FilesDocumentPanelSource;
    panelSources?: readonly FilesDocumentPanelSource[];
  } = {}
) {
  let contents = "# Initial\n";
  let mtimeMs = 1;
  let watchListener: ((event: FileWatchEvent) => void) | null = null;
  const watchDispose = vi.fn();
  const readText = vi.fn(
    async (_request: { path: string; root: string }) => contents
  );
  const stat = vi.fn(async (request: { path: string; root: string }) => ({
    exists: true,
    isDirectory: false,
    mtimeMs,
    path: request.path,
    root: request.root,
    size: contents.length,
  }));
  const writeText = vi.fn(
    async (request: { contents: string; path: string; root: string }) => {
      contents = request.contents;
      mtimeMs += 1;
      return {
        mtimeMs,
        path: request.path,
        root: request.root,
        written: true as const,
      };
    }
  );
  const readDocument = vi.fn(
    async (request: { path: string; root: string }) => {
      const metadata = await stat(request);
      const value = await readText(request);
      return {
        canonicalPath: request.path,
        contents: value,
        eol: "lf" as const,
        format: { bom: false as const, encoding: "utf8" as const },
        kind: "text" as const,
        mode: 0o644,
        path: request.path,
        revision: `revision-${metadata.mtimeMs}`,
        root: request.root,
        size: value.length,
        writable: true,
      };
    }
  );
  const writeDocument = vi.fn(
    async (request: { contents: string; path: string; root: string }) => {
      try {
        const result = await writeText(request);
        return {
          committed: true as const,
          durability: options.durability ?? ("confirmed" as const),
          kind: "written" as const,
          mode: 0o644,
          mtimeMs: result.mtimeMs,
          revision: `revision-${result.mtimeMs}`,
          size: request.contents.length,
        };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "file_conflict"
        ) {
          return {
            kind: "conflict" as const,
            reason: "revision-mismatch" as const,
          };
        }
        throw error;
      }
    }
  );
  const watch = vi.fn(
    (_root: string, listener: (event: FileWatchEvent) => void) => {
      watchListener = listener;
      return watchDispose;
    }
  );
  const dialogs = {
    alert: vi.fn(async () => undefined),
    choice: vi.fn(async () => options.conflictChoice ?? ("cancel" as const)),
  };
  const notifications = { success: vi.fn() };
  const draftValues = options.draftValues ?? new Map<string, string>();
  let remainingDraftListFailures = options.draftListFailures ?? 0;
  const deleteDraft = vi.fn(async (key: string) => draftValues.delete(key));
  const setDraft = vi.fn<RendererPluginContext["files"]["drafts"]["set"]>(
    async (key: string, generation: number, value: string) => {
      draftValues.set(key, value);
      return {
        bytes: value.length,
        generation,
        key,
        kind: "stored" as const,
        updatedAt: Date.now(),
      };
    }
  );
  const flushLayout = vi.fn(async () => undefined);
  const updateInstanceParams = vi.fn(() => true);
  const confirmDurability = vi.fn(async () => ({
    kind: "confirmed" as const,
    revision: `revision-${mtimeMs}`,
  }));
  const inspectPathImpact = vi.fn(
    async (request: { path: string; root: string }) => ({
      canonicalBackingPrefix: request.path,
      kind: "regular" as const,
      locatorPrefix: request.path,
      root: request.root,
    })
  );
  const move = vi.fn(
    async (request: { newPath: string; path: string; root: string }) => ({
      moved: true as const,
      newPath: request.newPath,
      oldPath: request.path,
      root: request.root,
    })
  );
  const context = {
    configuration: {
      get: vi.fn(() => options.autoSave === true),
      onDidChange: vi.fn(() => vi.fn()),
    },
    dialogs,
    files: {
      confirmDurability,
      drafts: {
        claimLegacy: vi.fn(async () => ({ kind: "not-found" as const })),
        delete: deleteDraft,
        get: vi.fn(async (key: string) => {
          const value = draftValues.get(key);
          return value === undefined
            ? null
            : {
                bytes: value.length,
                generation: 1,
                key,
                updatedAt: 1,
                value,
              };
        }),
        listDiagnostics: vi.fn(async () => options.draftDiagnostics ?? []),
        listKeys: vi.fn(async () => {
          if (remainingDraftListFailures > 0) {
            remainingDraftListFailures -= 1;
            throw new Error("temporary draft backend failure");
          }
          return [...draftValues.keys()];
        }),
        set: setDraft,
      },
      inspectWriteTarget: vi.fn(async (_request) => ({
        fileType: "text" as const,
        kind: "existing" as const,
        revision: `revision-${mtimeMs}`,
        size: contents.length,
      })),
      inspectPathImpact,
      move,
      readDocument,
      readText,
      stat,
      watch,
      writeText,
      writeDocument,
    },
    i18n: {
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
      ),
    },
    notifications,
    panels: {
      flushLayout,
      listInstances: vi.fn(() =>
        (options.panelSources ?? [options.panelSource ?? SOURCE]).map(
          (source, index) => ({
            componentId: "pier.files.filePanel",
            groupId: "group-1",
            id: `panel-${index + 1}`,
            params: { source },
            title: source.kind === "disk" ? source.path : source.name,
          })
        )
      ),
      updateInstanceParams,
    },
  } as unknown as RendererPluginContext;
  const watchHub = new FilesWatchHub(context.files);
  const controller = new FileEditorController(context, watchHub);
  return {
    controller,
    confirmDurability,
    dialogs,
    deleteDraft,
    flushLayout,
    inspectPathImpact,
    move,
    notifications,
    readDocument,
    readText,
    setDisk(nextContents: string, nextMtime: number) {
      contents = nextContents;
      mtimeMs = nextMtime;
    },
    setDraft,
    stat,
    updateInstanceParams,
    watch,
    watchDispose,
    watchEvent(event: FileWatchEvent) {
      if (!watchListener) {
        throw new Error("file watch was not acquired");
      }
      watchListener(event);
    },
    watchHub,
    writeDocument,
    writeText,
  };
}

afterEach(async () => {
  await flushFilesDraftWrites();
  clearFilesDocumentStore();
  await flushFilesDraftWrites();
  resetFilesDraftBackendForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FileEditorController", () => {
  it("reports isolated draft diagnostics without blocking initialization", async () => {
    const harness = createHarness({
      draftDiagnostics: [
        {
          id: "corrupt-1",
          message: "A protected draft was isolated",
          quarantinedAt: 1,
        },
      ],
    });

    await expect(harness.controller.initialize()).resolves.toBeUndefined();

    expect(harness.dialogs.alert).toHaveBeenCalledWith({
      body: "A protected draft was isolated",
      size: "default",
      title: "Unable to restore protected drafts",
    });
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("isolates and reports malformed document draft content", async () => {
    const draftValues = new Map([["pier.files.diskDraft:broken", "{invalid"]]);
    const harness = createHarness({ draftValues });

    await expect(harness.controller.initialize()).resolves.toBeUndefined();

    expect(harness.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("pier.files.diskDraft:broken"),
      })
    );
    expect(draftValues.has("pier.files.diskDraft:broken")).toBe(false);
    expect(
      [...draftValues.keys()].some((key) =>
        key.startsWith("pier.files.corruptDocumentDraft:")
      )
    ).toBe(true);
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("allows draft backend initialization to retry after a transient failure", async () => {
    const harness = createHarness({ draftListFailures: 1 });

    await expect(harness.controller.initialize()).rejects.toThrow(
      "Unable to load protected file drafts"
    );
    await expect(harness.controller.initialize()).resolves.toBeUndefined();

    expect(harness.dialogs.alert).toHaveBeenCalledTimes(1);
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("rebinds and flushes a preserved untitled panel before deleting the disk draft", async () => {
    const draftValues = new Map<string, string>();
    const harness = createHarness({ draftValues });
    await harness.controller.initialize();
    const release = harness.controller.acquirePanel("panel-1", SOURCE);
    await flushPromises();
    const document = getDocument(harness.controller.documentId(SOURCE));
    expect(document).not.toBeNull();
    updateDocumentContents(document?.id ?? "", "protected contents");
    harness.deleteDraft.mockClear();

    const [preserved] = await harness.controller.preserveDocumentsAsUntitled(
      document ? [document] : []
    );

    expect(preserved?.source.kind).toBe("untitled");
    expect(harness.updateInstanceParams).toHaveBeenCalledWith(
      "pier.files.filePanel",
      "panel-1",
      {
        source: {
          id: preserved?.id,
          kind: "untitled",
          name: preserved?.name,
        },
      }
    );
    expect(harness.flushLayout).toHaveBeenCalledTimes(1);
    expect(harness.deleteDraft).toHaveBeenCalled();
    expect(harness.flushLayout.mock.invocationCallOrder[0]).toBeLessThan(
      harness.deleteDraft.mock.invocationCallOrder[0] ?? 0
    );

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
    clearFilesDocumentStore({ persisted: false });
    resetFilesDraftBackendForTests();
    const restoredSource =
      preserved?.source.kind === "untitled"
        ? ({
            id: preserved.id,
            kind: "untitled",
            name: preserved.name,
          } as const)
        : null;
    const restarted = createHarness({
      draftValues,
      ...(restoredSource ? { panelSource: restoredSource } : {}),
    });
    await restarted.controller.initialize();
    const restoredRelease = restoredSource
      ? restarted.controller.acquirePanel("panel-1", restoredSource)
      : () => undefined;
    await flushPromises();
    const restored = restoredSource
      ? getDocument(restarted.controller.documentId(restoredSource))
      : null;
    expect(restored?.currentContents).toBe("protected contents");
    restoredRelease();
    restarted.controller.dispose();
    restarted.watchHub.dispose();
  });

  it("keeps the disk identity when the untitled draft cannot be persisted", async () => {
    const harness = createHarness();
    await harness.controller.initialize();
    const release = harness.controller.acquirePanel("panel-1", SOURCE);
    await flushPromises();
    const document = getDocument(harness.controller.documentId(SOURCE));
    updateDocumentContents(document?.id ?? "", "protected contents");
    await flushFilesDraftWrites();
    harness.setDraft.mockResolvedValueOnce({
      kind: "failed",
      message: "storage unavailable",
    });

    await expect(
      harness.controller.preserveDocumentsAsUntitled(document ? [document] : [])
    ).rejects.toThrow("storage unavailable");

    expect(getDocument(document?.id ?? "")?.source.kind).toBe("disk");
    expect(harness.updateInstanceParams).not.toHaveBeenCalled();
    expect(harness.flushLayout).not.toHaveBeenCalled();
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("rolls every converted document back before reporting a persistent multi-file failure", async () => {
    const sources = ["a.md", "b.md", "c.md"].map((path) => ({
      kind: "disk" as const,
      path,
      root: ROOT,
    }));
    const harness = createHarness({ panelSources: sources });
    await harness.controller.initialize();
    const releases = sources.map((source, index) =>
      harness.controller.acquirePanel(`panel-${index + 1}`, source)
    );
    await flushPromises();
    const documents = sources.flatMap((source) => {
      const document = getDocument(harness.controller.documentId(source));
      if (!document) return [];
      updateDocumentContents(document.id, `protected ${source.path}`);
      return [document];
    });
    await flushFilesDraftWrites();
    let untitledWrites = 0;
    harness.setDraft.mockImplementation(async (key, generation, value) => {
      if (key.startsWith("pier.files.untitledDraft:")) untitledWrites += 1;
      if (untitledWrites >= 3) {
        return { kind: "failed", message: "persistent storage failure" };
      }
      return {
        bytes: value.length,
        generation,
        key,
        kind: "stored",
        updatedAt: 1,
      };
    });

    await expect(
      harness.controller.preserveDocumentsAsUntitled(documents)
    ).rejects.toThrow("persistent storage failure");

    for (const document of documents) {
      expect(getDocument(document.id)?.source.kind).toBe("disk");
    }
    for (const release of releases) release();
    harness.controller.dispose();
    harness.watchHub.dispose();
    resetFilesDraftBackendForTests();
  });

  it("rolls panel and document identity back when layout persistence fails", async () => {
    const harness = createHarness();
    await harness.controller.initialize();
    const release = harness.controller.acquirePanel("panel-1", SOURCE);
    await flushPromises();
    const document = getDocument(harness.controller.documentId(SOURCE));
    updateDocumentContents(document?.id ?? "", "protected contents");
    harness.flushLayout
      .mockRejectedValueOnce(new Error("layout unavailable"))
      .mockResolvedValueOnce(undefined);
    harness.deleteDraft.mockClear();

    await expect(
      harness.controller.preserveDocumentsAsUntitled(document ? [document] : [])
    ).rejects.toThrow("layout unavailable");

    expect(getDocument(document?.id ?? "")?.source.kind).toBe("disk");
    expect(harness.updateInstanceParams).toHaveBeenNthCalledWith(
      2,
      "pier.files.filePanel",
      "panel-1",
      { source: SOURCE }
    );
    expect(harness.flushLayout).toHaveBeenCalledTimes(2);
    expect(
      harness.deleteDraft.mock.calls.some(([key]) =>
        key.startsWith("pier.files.diskDraft:")
      )
    ).toBe(false);
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("refuses to move onto an open target with protected changes", async () => {
    const harness = createHarness();
    const target = {
      kind: "disk" as const,
      path: "renamed.md",
      root: ROOT,
    };
    const releaseSource = harness.controller.acquirePanel("source", SOURCE);
    const releaseTarget = harness.controller.acquirePanel("target", target);
    await flushPromises();
    updateDocumentContents(
      harness.controller.documentId(target),
      "protected target"
    );

    await expect(
      harness.controller.movePath(ROOT, SOURCE.path, target.path)
    ).rejects.toThrow("protected unsaved changes");

    expect(harness.move).not.toHaveBeenCalled();
    releaseTarget();
    releaseSource();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("aborts lifecycle drain while a document read never settles", async () => {
    const harness = createHarness();
    harness.readDocument.mockImplementationOnce(
      async () => await new Promise(() => undefined)
    );
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const abort = new AbortController();
    const suspension = harness.controller.suspendMutations(abort.signal);

    abort.abort();

    await expect(suspension).rejects.toMatchObject({ name: "AbortError" });
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("aborts lifecycle drain while a document write never settles", async () => {
    const harness = createHarness();
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(documentId, "# pending save\n");
    harness.writeDocument.mockImplementationOnce(
      async () => await new Promise(() => undefined)
    );
    const pendingSave = harness.controller.saveDocument(
      documentId,
      "panel",
      "none"
    );
    expect(pendingSave).toBeInstanceOf(Promise);
    await flushPromises();
    const abort = new AbortController();
    const suspension = harness.controller.suspendMutations(abort.signal);

    abort.abort();

    await expect(suspension).rejects.toMatchObject({ name: "AbortError" });
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("coalesces document loading, root watching, and auto-save across panels", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ autoSave: true });
    await harness.controller.initialize();
    const releaseA = harness.controller.acquirePanel("panel-a", SOURCE);
    const releaseB = harness.controller.acquirePanel("panel-b", SOURCE);

    await flushPromises();
    expect(harness.stat).toHaveBeenCalledOnce();
    expect(harness.readText).toHaveBeenCalledOnce();
    expect(harness.watch).toHaveBeenCalledOnce();

    const documentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(documentId, "# Edited\n");
    await vi.advanceTimersByTimeAsync(1000);

    expect(harness.writeText).toHaveBeenCalledOnce();
    releaseA();
    expect(harness.watchDispose).not.toHaveBeenCalled();
    releaseB();
    expect(harness.watchDispose).toHaveBeenCalledOnce();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("reloads clean documents and marks dirty documents conflicted without a file tree", async () => {
    const harness = createHarness();
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);

    const firstReload = deferred<string>();
    harness.readText.mockImplementationOnce(() => firstReload.promise);
    harness.setDisk("# External\n", 2);
    harness.watchEvent({
      changes: [{ kind: "changed", path: SOURCE.path }],
      root: ROOT,
    });
    await flushPromises();
    harness.setDisk("# Latest external\n", 3);
    harness.watchEvent({
      changes: [{ kind: "changed", path: SOURCE.path }],
      root: ROOT,
    });
    firstReload.resolve("# External\n");
    await vi.waitFor(() =>
      expect(getDocument(documentId)?.currentContents).toBe(
        "# Latest external\n"
      )
    );

    updateDocumentContents(documentId, "# Local\n");
    harness.setDisk("# External again\n", 4);
    harness.watchEvent({
      changes: [{ kind: "changed", path: SOURCE.path }],
      root: ROOT,
    });
    await flushPromises();
    expect(getDocument(documentId)?.currentContents).toBe("# Local\n");
    expect(getDocument(documentId)?.diskConflict).toBe(true);
    expect(harness.readText).toHaveBeenCalledTimes(4);

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("keeps the buffer and marks the document deleted when its backing file disappears", async () => {
    const harness = createHarness();
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(documentId, "# Local content survives\n");
    harness.readDocument.mockRejectedValueOnce(
      Object.assign(new Error("The file no longer exists"), {
        code: "not_found",
      })
    );

    harness.watchEvent({
      changes: [{ kind: "deleted", path: SOURCE.path }],
      root: ROOT,
    });

    await vi.waitFor(() =>
      expect(getDocument(documentId)).toMatchObject({
        currentContents: "# Local content survives\n",
        deletedOnDisk: true,
        dirty: true,
        diskConflict: true,
        hasBackingStore: false,
      })
    );
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("ignores a stale load after discard and allows the reopened document to load", async () => {
    const harness = createHarness();
    const oldRead = deferred<string>();
    const newRead = deferred<string>();
    harness.readText
      .mockImplementationOnce(() => oldRead.promise)
      .mockImplementationOnce(() => newRead.promise);
    const releaseOld = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);

    harness.controller.discardDocument(documentId);
    releaseOld();
    const releaseNew = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    expect(harness.readText).toHaveBeenCalledTimes(2);

    newRead.resolve("# New session\n");
    await flushPromises();
    expect(getDocument(documentId)?.currentContents).toBe("# New session\n");
    oldRead.resolve("# Stale session\n");
    await flushPromises();
    expect(getDocument(documentId)?.currentContents).toBe("# New session\n");

    releaseNew();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("does not let a stale save completion mutate a reopened document", async () => {
    const harness = createHarness();
    const oldWrite = deferred<WriteResult>();
    const newWrite = deferred<WriteResult>();
    harness.writeText
      .mockImplementationOnce(() => oldWrite.promise)
      .mockImplementationOnce(() => newWrite.promise);
    const releaseOld = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(documentId, "# Old edit\n");
    const oldSave = harness.controller.saveDocument(
      documentId,
      "panel",
      "none"
    );
    await flushPromises();

    harness.controller.discardDocument(documentId);
    releaseOld();
    const releaseNew = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    updateDocumentContents(documentId, "# New edit\n");
    const newSave = harness.controller.saveDocument(
      documentId,
      "panel",
      "none"
    );
    oldWrite.resolve({
      mtimeMs: 2,
      path: SOURCE.path,
      root: ROOT,
      written: true,
    });
    await oldSave;
    expect(getDocument(documentId)?.saveState).toBe("saving");

    newWrite.resolve({
      mtimeMs: 3,
      path: SOURCE.path,
      root: ROOT,
      written: true,
    });
    await newSave;
    expect(getDocument(documentId)?.dirty).toBe(false);
    expect(getDocument(documentId)?.currentContents).toBe("# New edit\n");

    releaseNew();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("invalidates an in-flight save when the open document is renamed", async () => {
    const harness = createHarness();
    const oldWrite = deferred<WriteResult>();
    harness.writeText.mockImplementationOnce(() => oldWrite.promise);
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const oldDocumentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(oldDocumentId, "# Renamed edit\n");
    const oldSave = harness.controller.saveDocument(
      oldDocumentId,
      "panel",
      "none"
    );
    await flushPromises();

    const renamedSource = { ...SOURCE, path: "RENAMED.md" };
    await harness.controller.moveDiskDocumentSource(
      ROOT,
      SOURCE.path,
      renamedSource.path
    );
    const renamedDocumentId = harness.controller.documentId(renamedSource);
    expect(getDocument(renamedDocumentId)?.saveState).toBe("idle");
    expect(getDocument(renamedDocumentId)?.dirty).toBe(true);

    oldWrite.resolve({
      mtimeMs: 2,
      path: SOURCE.path,
      root: ROOT,
      written: true,
    });
    await expect(oldSave).resolves.toBe("noop");
    expect(getDocument(renamedDocumentId)?.dirty).toBe(true);
    await expect(
      harness.controller.saveDocument(renamedDocumentId, "panel", "none")
    ).resolves.toBe("saved");

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("schedules a second auto-save when edits arrive during an in-flight save", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ autoSave: true });
    const firstWrite = deferred<WriteResult>();
    harness.writeText
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(async (request) => ({
        mtimeMs: 3,
        path: request.path,
        root: request.root,
        written: true as const,
      }));
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);

    updateDocumentContents(documentId, "# First edit\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.writeText).toHaveBeenCalledOnce();
    updateDocumentContents(documentId, "# Newer edit\n");
    firstWrite.resolve({
      mtimeMs: 2,
      path: SOURCE.path,
      root: ROOT,
      written: true,
    });
    await flushPromises();
    expect(getDocument(documentId)?.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.writeText).toHaveBeenCalledTimes(2);
    expect(harness.writeText.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ contents: "# Newer edit\n" })
    );

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("reports manual save success and detailed failure feedback", async () => {
    const harness = createHarness();
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);

    updateDocumentContents(documentId, "# Saved\n");
    await expect(
      harness.controller.saveDocument(documentId, "panel")
    ).resolves.toBe("saved");
    expect(harness.notifications.success).toHaveBeenCalledWith("File saved");

    updateDocumentContents(documentId, "# Failed\n");
    harness.writeText.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      harness.controller.saveDocument(documentId, "panel")
    ).resolves.toBe("failed");
    expect(harness.dialogs.alert).toHaveBeenCalledWith({
      body: "disk full",
      title: "Unable to save file",
    });

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("keeps a committed draft until durability is explicitly confirmed", async () => {
    const harness = createHarness({ durability: "unknown" });
    await harness.controller.initialize();
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);

    updateDocumentContents(documentId, "# Saved but not synced\n");
    await harness.controller.saveDocument(documentId, "panel", "none");

    expect(getDocument(documentId)).toMatchObject({
      dirty: false,
      durabilityUnknown: true,
    });
    expect(await harness.controller.confirmDocumentDurability(documentId)).toBe(
      true
    );
    expect(harness.confirmDurability).toHaveBeenCalledWith({
      expectedRevision: "revision-2",
      path: SOURCE.path,
      root: ROOT,
    });
    expect(getDocument(documentId)).toMatchObject({
      dirty: false,
      durabilityUnknown: false,
    });

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("suppresses per-document durability alerts when an aggregate action owns feedback", async () => {
    const harness = createHarness({ durability: "unknown" });
    const release = harness.controller.acquirePanel("panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);
    updateDocumentContents(documentId, "# Durability pending\n");
    await harness.controller.saveDocument(documentId, "panel", "none");
    harness.confirmDurability.mockRejectedValueOnce(new Error("fsync failed"));

    await expect(
      harness.controller.confirmDocumentDurability(documentId, "none")
    ).resolves.toBe(false);

    expect(harness.dialogs.alert).not.toHaveBeenCalled();
    expect(getDocument(documentId)).toMatchObject({
      durabilityUnknown: true,
      error: "fsync failed",
    });
    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });

  it("delivers a deferred compare mode when a conflicted panel is inactive", async () => {
    const harness = createHarness({ conflictChoice: "alt" });
    await harness.controller.initialize();
    const release = harness.controller.acquirePanel("inactive-panel", SOURCE);
    const documentId = harness.controller.documentId(SOURCE);
    await vi.waitFor(() =>
      expect(getDocument(documentId)?.loadState).toBe("loaded")
    );
    updateDocumentContents(documentId, "# Local edit\n");
    harness.writeText.mockRejectedValueOnce(
      Object.assign(new Error("changed"), { code: "file_conflict" })
    );

    await expect(
      harness.controller.saveDocument(documentId, "inactive-panel")
    ).resolves.toBe("compare");
    const setMode = vi.fn();
    harness.controller.registerPanelModeHandler("inactive-panel", setMode);

    expect(setMode).toHaveBeenCalledOnce();
    expect(setMode).toHaveBeenCalledWith("diff");
    expect(getDocument(documentId)?.conflictDiskContents).toBe("# Initial\n");

    release();
    harness.controller.dispose();
    harness.watchHub.dispose();
  });
});
