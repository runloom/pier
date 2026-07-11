import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  recoverDocumentSaveAs,
  saveDocumentAs,
} from "@plugins/builtin/files/renderer/file-save-as-state-machine.ts";
import { flushFilesDraftWrites } from "@plugins/builtin/files/renderer/files-document-drafts.ts";
import {
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  markDocumentReadResult,
  resetFilesDraftBackendForTests,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import {
  createSaveAsJournal,
  saveAsJournalForDocument,
} from "@plugins/builtin/files/renderer/files-save-as-journal.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const panelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-repo",
  cwd: "/repo",
  gitRoot: "/repo",
  openedPath: "/repo",
  projectRootPath: "/repo",
  source: "panel",
  updatedAt: 1,
  worktreeKey: "/repo",
  worktreeRoot: "/repo",
};

function createContext(
  options: {
    confirm?: boolean;
    existing?: boolean;
    targetPath?: string | null;
    writeDurability?: "confirmed" | "unknown";
  } = {}
) {
  const targetPath =
    options.targetPath === undefined ? "saved.md" : options.targetPath;
  const writeDocument = vi.fn<RendererPluginContext["files"]["writeDocument"]>(
    async (request) => ({
      canonicalPath: targetPath ?? "saved.md",
      committed: true as const,
      durability: options.writeDurability ?? ("confirmed" as const),
      kind: "written" as const,
      mode: 0o644,
      mtimeMs: 2,
      revision: "revision-written",
      size: request.contents.length,
    })
  );
  const context = {
    dialogs: {
      alert: vi.fn(async () => undefined),
      confirm: vi.fn(async () => options.confirm ?? true),
    },
    files: {
      confirmDurability: vi.fn(async (request) => ({
        kind: "confirmed" as const,
        revision: request.expectedRevision,
      })),
      inspectWriteTarget: vi.fn(async () =>
        options.existing
          ? {
              fileType: "text" as const,
              kind: "existing" as const,
              revision: "revision-existing",
              size: 4,
            }
          : { kind: "absent" as const }
      ),
      pickSaveTarget: vi.fn(async () =>
        targetPath
          ? { context: panelContext, path: targetPath, root: "/repo" }
          : null
      ),
      readDocument: vi.fn(async () => ({
        canonicalPath: targetPath ?? "saved.md",
        contents: "source",
        eol: "none" as const,
        format: { bom: false as const, encoding: "utf8" as const },
        kind: "text" as const,
        mode: 0o644,
        path: targetPath ?? "saved.md",
        revision: "revision-written",
        root: "/repo",
        size: 6,
        writable: true,
      })),
      stat: vi.fn(async () => ({
        exists: true,
        isDirectory: false,
        mtimeMs: 2,
        path: targetPath ?? "saved.md",
        root: "/repo",
        size: 6,
      })),
      writeDocument,
    },
    i18n: {
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
      ),
    },
  } as unknown as RendererPluginContext;
  return { context, writeDocument };
}

beforeEach(async () => {
  await configureFilesDraftBackend({
    claimLegacy: async () => ({ kind: "not-found" }),
    delete: async () => false,
    get: async () => null,
    listKeys: async () => [],
    set: async (key, generation, value) => ({
      bytes: value.length,
      generation,
      key,
      kind: "stored",
      updatedAt: generation,
    }),
  });
});

afterEach(() => {
  clearFilesDocumentStore({ persisted: false });
  resetFilesDraftBackendForTests();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

describe("file save-as state machine", () => {
  it("writes an untitled document with no-replace and adopts the target", async () => {
    const document = createUntitledMarkdownDocument({ contents: "# draft\n" });
    const { context, writeDocument } = createContext();

    await expect(
      saveDocumentAs({ context, documentId: document.id, panelContext })
    ).resolves.toMatchObject({
      kind: "saved",
      source: { kind: "disk", path: "saved.md", root: "/repo" },
    });

    expect(writeDocument).toHaveBeenCalledWith({
      contents: "# draft\n",
      eol: "lf",
      expected: { kind: "absent" },
      format: { bom: false, encoding: "utf8" },
      operationId: expect.any(String),
      path: "saved.md",
      root: "/repo",
    });
    expect(
      getDocumentForPanelSource({
        kind: "disk",
        path: "saved.md",
        root: "/repo",
      })
    ).toMatchObject({ dirty: false, needsSaveAs: false });
    expect(getDocument(document.id)).not.toBeNull();
  });

  it("leaves the source untouched when target selection is cancelled", async () => {
    const document = createUntitledMarkdownDocument({ contents: "keep me" });
    const { context, writeDocument } = createContext({ targetPath: null });

    await expect(
      saveDocumentAs({ context, documentId: document.id, panelContext })
    ).resolves.toEqual({ kind: "cancelled" });

    expect(writeDocument).not.toHaveBeenCalled();
    expect(getDocument(document.id)?.currentContents).toBe("keep me");
  });

  it("requires explicit confirmation before replacing an existing target", async () => {
    const document = createUntitledMarkdownDocument({ contents: "keep me" });
    const { context, writeDocument } = createContext({
      confirm: false,
      existing: true,
    });

    await expect(
      saveDocumentAs({ context, documentId: document.id, panelContext })
    ).resolves.toEqual({ kind: "cancelled" });
    expect(writeDocument).not.toHaveBeenCalled();
  });

  it("does not overwrite an open target with protected changes", async () => {
    const document = createUntitledMarkdownDocument({ contents: "source" });
    const target = ensureDiskDocument({ path: "saved.md", root: "/repo" });
    updateDocumentContents(target.id, "protected target");
    const { context, writeDocument } = createContext({ existing: true });

    await expect(
      saveDocumentAs({ context, documentId: document.id, panelContext })
    ).resolves.toEqual({ kind: "failed" });

    expect(writeDocument).not.toHaveBeenCalled();
    expect(context.dialogs.alert).toHaveBeenCalledOnce();
  });

  it("uses the opened revision when Save As selects the current disk path", async () => {
    const document = ensureDiskDocument({ path: "saved.md", root: "/repo" });
    markDocumentReadResult(document.id, {
      canonicalPath: "saved.md",
      contents: "baseline\n",
      eol: "lf",
      format: { bom: false, encoding: "utf8" },
      kind: "text",
      mode: 0o644,
      path: "saved.md",
      revision: "revision-opened",
      root: "/repo",
      size: 9,
      writable: true,
    });
    updateDocumentContents(document.id, "local edit\n");
    const { context, writeDocument } = createContext({
      existing: true,
      targetPath: "saved.md",
    });
    writeDocument.mockResolvedValueOnce({
      kind: "conflict",
      reason: "revision-mismatch",
    });

    await expect(
      saveDocumentAs({ context, documentId: document.id, panelContext })
    ).resolves.toEqual({ kind: "failed" });

    expect(writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: { kind: "revision", revision: "revision-opened" },
      })
    );
    expect(context.dialogs.confirm).not.toHaveBeenCalled();
    expect(getDocument(document.id)?.currentContents).toBe("local edit\n");
  });

  it("retains a target recovery draft when durability is unknown", async () => {
    const document = createUntitledMarkdownDocument({ contents: "source" });
    const { context } = createContext({ writeDurability: "unknown" });

    const result = await saveDocumentAs({
      context,
      documentId: document.id,
      panelContext,
    });

    expect(result).toMatchObject({ kind: "saved" });
    if (result.kind !== "saved") {
      throw new Error("expected saved result");
    }
    expect(getDocument(result.documentId)).toMatchObject({
      dirty: false,
      durabilityUnknown: true,
    });
  });

  it("resumes panel binding from a durable written Save As journal", async () => {
    const document = createUntitledMarkdownDocument({ contents: "source" });
    const { context } = createContext();

    await expect(
      saveDocumentAs({
        context,
        documentId: document.id,
        onCommitted: async () => {
          throw new Error("panel migration interrupted");
        },
        panelContext,
      })
    ).resolves.toEqual({ kind: "failed" });

    expect(saveAsJournalForDocument(document.id)).toMatchObject({
      phase: "written",
      sourceDocumentId: document.id,
    });
    vi.mocked(context.files.inspectWriteTarget).mockResolvedValueOnce({
      fileType: "text",
      kind: "existing",
      revision: "revision-written",
      size: 6,
    });
    const onCommitted = vi.fn(async () => undefined);

    await expect(
      recoverDocumentSaveAs({
        context,
        documentId: document.id,
        onCommitted,
      })
    ).resolves.toBe(true);

    expect(onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "saved",
        source: { kind: "disk", path: "saved.md", root: "/repo" },
      })
    );
    expect(saveAsJournalForDocument(document.id)).toBeNull();
  });

  it("recovers a committed target while the durable journal still says prepared", async () => {
    const document = createUntitledMarkdownDocument({ contents: "source" });
    const { context } = createContext({ existing: true });
    createSaveAsJournal({
      eol: "lf",
      format: { bom: false, encoding: "utf8" },
      savedContents: "source",
      source: { id: document.id, kind: "untitled", name: document.name },
      sourceDocumentId: document.id,
      target: { context: panelContext, path: "saved.md", root: "/repo" },
    });
    await flushFilesDraftWrites();
    vi.mocked(context.files.inspectWriteTarget).mockResolvedValueOnce({
      fileType: "text",
      kind: "existing",
      revision: "revision-written",
      size: 6,
    });
    const onCommitted = vi.fn(async () => undefined);

    await expect(
      recoverDocumentSaveAs({
        context,
        documentId: document.id,
        onCommitted,
      })
    ).resolves.toBe(true);

    expect(context.files.confirmDurability).toHaveBeenCalledWith({
      expectedRevision: "revision-written",
      path: "saved.md",
      root: "/repo",
    });
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(saveAsJournalForDocument(document.id)).toBeNull();
  });
});
