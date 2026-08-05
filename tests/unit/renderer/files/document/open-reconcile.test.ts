import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { clearDiskReplaceAuthorizationsForTests } from "@plugins/builtin/files/renderer/document/disk-protection.ts";
import { OpenDocumentReconciler } from "@plugins/builtin/files/renderer/document/open-reconcile.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  getDocument,
  markDocumentReadResult,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  clearFilesDocumentStore();
  clearDiskReplaceAuthorizationsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function seedDocument(contents = "# seed\n", mtimeMs = 1000) {
  const document = ensureDiskDocument({
    path: "notes.md",
    root: "/repo",
  });
  markDocumentReadResult(document.id, {
    canonicalPath: "notes.md",
    contents,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: 0o644,
    mtimeMs,
    path: "notes.md",
    revision: `revision-${mtimeMs}`,
    root: "/repo",
    size: contents.length,
    writable: true,
  });
  return getDocument(document.id)!;
}

describe("OpenDocumentReconciler", () => {
  it("reloads when stat mtime diverges from baseMtimeMs", async () => {
    const document = seedDocument("# seed\n", 1000);
    expect(document.baseMtimeMs).toBe(1000);
    const loader = { start: vi.fn() };
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: {
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 2000,
            path: "notes.md",
            root: "/repo",
            size: document.size,
          })),
        },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    await vi.waitFor(() => expect(loader.start).toHaveBeenCalled());
    expect(loader.start).toHaveBeenCalledWith(document.id, true);
    reconciler.dispose();
  });

  it("does not reload when mtime and size are unchanged", async () => {
    const document = seedDocument("# seed\n", 1000);
    const loader = { start: vi.fn() };
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: {
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 1000,
            path: "notes.md",
            root: "/repo",
            size: document.size,
          })),
        },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.start).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it("schedules reload when the backing file is absent", async () => {
    const document = seedDocument();
    const loader = { start: vi.fn() };
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: {
          stat: vi.fn(async () => ({
            exists: false,
            isDirectory: false,
            mtimeMs: null,
            path: "notes.md",
            root: "/repo",
            size: null,
          })),
        },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    await vi.waitFor(() =>
      expect(loader.start).toHaveBeenCalledWith(document.id, true)
    );
    reconciler.dispose();
  });

  it("still reloads dirty documents so loader can mark conflict", async () => {
    const document = seedDocument("# saved\n", 1000);
    updateDocumentContents(document.id, "# local\n");
    const loader = { start: vi.fn() };
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: {
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 5000,
            path: "notes.md",
            root: "/repo",
            size: 20,
          })),
        },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    await vi.waitFor(() =>
      expect(loader.start).toHaveBeenCalledWith(document.id, true)
    );
    reconciler.dispose();
  });

  it("does not periodic-reload when fingerprint is still unknown", async () => {
    const document = ensureDiskDocument({
      path: "notes.md",
      root: "/repo",
    });
    // Idle shell: no successful text load → baseMtimeMs/size null.
    expect(getDocument(document.id)?.baseMtimeMs).toBeNull();
    const loader = { start: vi.fn() };
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: {
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 9999,
            path: "notes.md",
            root: "/repo",
            size: 42,
          })),
        },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.start).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it("queues a second pass when reconcileSoon is called during an in-flight run", async () => {
    const document = seedDocument("# seed\n", 1000);
    const loader = { start: vi.fn() };
    let releaseStat!: () => void;
    const statGate = new Promise<void>((resolve) => {
      releaseStat = resolve;
    });
    const stat = vi.fn(async () => {
      await statGate;
      return {
        exists: true,
        isDirectory: false,
        mtimeMs: 1000,
        path: "notes.md",
        root: "/repo",
        size: document.size,
      };
    });
    const reconciler = new OpenDocumentReconciler({
      context: {
        files: { stat },
      } as unknown as RendererPluginContext,
      getDocumentIds: () => new Set([document.id]),
      loader,
    });

    reconciler.reconcileSoon();
    reconciler.reconcileSoon();
    releaseStat();
    await vi.waitFor(() =>
      expect(stat.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    reconciler.dispose();
  });
});
