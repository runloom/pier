import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileEditorController } from "@plugins/builtin/files/renderer/file-editor-controller.ts";
import {
  clearFilesDocumentStore,
  getDocument,
  resetFilesDraftBackendForTests,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
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
  } = {}
) {
  let contents = "# Initial\n";
  let mtimeMs = 1;
  let watchListener: ((event: FileWatchEvent) => void) | null = null;
  const watchDispose = vi.fn();
  const readText = vi.fn(async () => contents);
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
  const context = {
    configuration: {
      get: vi.fn(() => options.autoSave === true),
      onDidChange: vi.fn(() => vi.fn()),
    },
    dialogs,
    files: {
      drafts: {
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      readText,
      stat,
      watch,
      writeText,
    },
    i18n: {
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
      ),
    },
    notifications,
  } as unknown as RendererPluginContext;
  const watchHub = new FilesWatchHub(context.files);
  const controller = new FileEditorController(context, watchHub);
  return {
    controller,
    dialogs,
    notifications,
    readText,
    setDisk(nextContents: string, nextMtime: number) {
      contents = nextContents;
      mtimeMs = nextMtime;
    },
    stat,
    watch,
    watchDispose,
    watchEvent(event: FileWatchEvent) {
      if (!watchListener) {
        throw new Error("file watch was not acquired");
      }
      watchListener(event);
    },
    watchHub,
    writeText,
  };
}

afterEach(() => {
  clearFilesDocumentStore();
  resetFilesDraftBackendForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FileEditorController", () => {
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
    await flushPromises();
    expect(getDocument(documentId)?.currentContents).toBe(
      "# Latest external\n"
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
    expect(harness.readText).toHaveBeenCalledTimes(3);

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
    harness.controller.moveDiskDocumentSource(
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

  it("delivers a deferred compare mode when a conflicted panel is inactive", async () => {
    const harness = createHarness({ conflictChoice: "alt" });
    const release = harness.controller.acquirePanel("inactive-panel", SOURCE);
    await flushPromises();
    const documentId = harness.controller.documentId(SOURCE);
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
