import {
  diskDraftStorageKey,
  parsePersistedDiskDraft,
  parsePersistedUntitledDocument,
  transferStagingDraftKey,
  untitledDraftStorageKey,
} from "@plugins/builtin/files/renderer/files-document-draft-records.ts";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/files-document-factory.ts";
import {
  allocateExplicitDiskDocumentId,
  diskDocumentId,
} from "@plugins/builtin/files/renderer/files-document-paths.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { FilesMutationGate } from "@plugins/builtin/files/renderer/files-mutation-gate.ts";
import { FilesMutationSuspendCoordinator } from "@plugins/builtin/files/renderer/files-mutation-suspend-coordinator.ts";
import {
  clearFilesPanelTransferBookkeepingForTests,
  createFilesPanelTransferRegistration,
  type FilesPanelTransferDeps,
} from "@plugins/builtin/files/renderer/files-panel-transfer.ts";
import {
  clearFilesPanelTransferViewSeedsForTests,
  parseFilesPanelTransferPreparedState,
  seedFilesPanelView,
  takeFilesPanelViewSeed,
} from "@plugins/builtin/files/renderer/files-panel-transfer-state.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const TRANSFER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROOT = "/repo";
const PATH = "README.md";

function diskDocument(
  overrides: Partial<FilesDocument> & {
    id?: string;
    path?: string;
    root?: string;
  } = {}
): FilesDocument {
  const root = overrides.root ?? ROOT;
  const path = overrides.path ?? PATH;
  const id = overrides.id ?? diskDocumentId(root, path);
  const base = createDiskDocumentRecord({
    draft: null,
    id,
    path,
    root,
  });
  const { path: _p, root: _r, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    id,
    source: { kind: "disk", path, root },
  };
}

function untitledDocument(
  overrides: Partial<FilesDocument> & { id?: string; name?: string } = {}
): FilesDocument {
  const id = overrides.id ?? `pier.files.untitled:${crypto.randomUUID()}`;
  const name = overrides.name ?? "Untitled-1.md";
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: [],
    conflictDiskContents: null,
    currentContents: overrides.currentContents ?? "# untitled\n",
    deletedOnDisk: false,
    dirty: overrides.dirty ?? true,
    diskConflict: false,
    durabilityUnknown: false,
    eol: "lf",
    error: null,
    format: "text",
    hasBackingStore: false,
    id,
    language: "markdown",
    loadState: "loaded",
    mime: "text/markdown",
    mode: null,
    name,
    needsSaveAs: false,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    savedContents: overrides.savedContents ?? "",
    saveState: "idle",
    size: null,
    source: {
      id,
      kind: "untitled",
      language: "markdown",
      name,
    },
    ...overrides,
  } as FilesDocument;
}

function createDeps(
  options: {
    documents?: Map<string, FilesDocument>;
    drafts?: Map<string, string>;
    viewSnapshot?: {
      selection?: { anchor: number; head: number };
      scroll?: { left: number; top: number };
    } | null;
  } = {}
): FilesPanelTransferDeps & {
  drafts: Map<string, string>;
  documents: Map<string, FilesDocument>;
  discardDocument: ReturnType<typeof vi.fn>;
  resumeTransferMutations: ReturnType<typeof vi.fn>;
  suspendTransferMutations: ReturnType<typeof vi.fn>;
} {
  const documents = options.documents ?? new Map<string, FilesDocument>();
  const drafts = options.drafts ?? new Map<string, string>();
  const suspendTransferMutations = vi.fn(async () => undefined);
  const resumeTransferMutations = vi.fn(() => undefined);
  const discardDocument = vi.fn((documentId: string) => {
    documents.delete(documentId);
  });

  return {
    documents,
    drafts,
    allocateExplicitDiskDocumentId,
    captureViewSnapshot: () => options.viewSnapshot ?? null,
    discardDocument,
    ensureDiskDocument: (input) => {
      const id = input.documentId ?? diskDocumentId(input.root, input.path);
      const existing = documents.get(id);
      if (existing) {
        return existing;
      }
      const raw = drafts.get(diskDraftStorageKey(id)) ?? null;
      const draft = raw ? parsePersistedDiskDraft(raw) : null;
      const document = createDiskDocumentRecord({
        draft,
        id,
        path: input.path,
        root: input.root,
      });
      documents.set(id, document);
      return document;
    },
    flushFilesDraftWrites: async () => undefined,
    getDocument: (documentId) => documents.get(documentId) ?? null,
    getDocumentForPanelSource: (source) => {
      if (source.kind === "untitled") {
        return documents.get(source.id) ?? null;
      }
      const id = source.documentId ?? diskDocumentId(source.root, source.path);
      return documents.get(id) ?? null;
    },
    hydrateDraftKey: async (key) => drafts.get(key) ?? null,
    nextUntitledIdentity: () => {
      const id = `pier.files.untitled:${crypto.randomUUID()}`;
      return { id, name: "Untitled-99.md" };
    },
    persistFilesDraftRecord: (key, value) => {
      drafts.set(key, value);
    },
    readFilesPanelViewMode: () => "preview",
    removeFilesDraftRecord: (key) => {
      drafts.delete(key);
    },
    restoreUntitledDocumentFromPanelSource: (source) => {
      const existing = documents.get(source.id);
      if (existing) {
        return existing;
      }
      const raw = drafts.get(untitledDraftStorageKey(source.id));
      if (!raw) {
        return null;
      }
      const persisted = parsePersistedUntitledDocument(raw);
      if (!persisted) {
        return null;
      }
      const document = untitledDocument({
        currentContents: persisted.currentContents,
        dirty: persisted.dirty,
        id: source.id,
        name: persisted.name || source.name,
        savedContents: persisted.savedContents,
      });
      documents.set(source.id, document);
      return document;
    },
    resumeTransferMutations,
    suspendTransferMutations,
  };
}

afterEach(() => {
  clearFilesPanelTransferBookkeepingForTests();
  clearFilesPanelTransferViewSeedsForTests();
});

describe("files-panel-transfer", () => {
  it("prepares dirty / conflict / deleted / durabilityUnknown disk drafts without body in state", async () => {
    const cases: Array<{ label: string; patch: Partial<FilesDocument> }> = [
      { label: "dirty", patch: { currentContents: "# dirty", dirty: true } },
      {
        label: "diskConflict+conflictDiskContents",
        patch: {
          conflictDiskContents: "# on disk",
          dirty: true,
          diskConflict: true,
        },
      },
      {
        label: "deletedOnDisk",
        patch: {
          deletedOnDisk: true,
          dirty: true,
          diskConflict: true,
          hasBackingStore: false,
        },
      },
      {
        label: "durabilityUnknown",
        patch: { durabilityUnknown: true },
      },
    ];

    for (const { label, patch } of cases) {
      clearFilesPanelTransferBookkeepingForTests();
      const document = diskDocument(patch);
      const deps = createDeps({
        documents: new Map([[document.id, document]]),
        viewSnapshot: {
          scroll: { left: 12, top: 34 },
          selection: { anchor: 1, head: 4 },
        },
      });
      const reg = createFilesPanelTransferRegistration(deps);
      if (reg.kind !== "custom") {
        throw new Error("expected custom");
      }

      const prepared = await reg.prepareSource({
        panelId: "panel-1",
        params: { source: { kind: "disk", path: PATH, root: ROOT } },
        transferId: TRANSFER_ID,
      });

      expect(prepared.drafts, label).toHaveLength(1);
      const mapping = prepared.drafts![0]!;
      expect(mapping.sourceKey, label).toBe(
        transferStagingDraftKey(TRANSFER_ID, diskDraftStorageKey(document.id))
      );
      expect(mapping.targetKey, label).toMatch(/^pier\.files\.diskDraft:/);
      expect(mapping.targetKey, label).not.toBe(
        diskDraftStorageKey(document.id)
      );

      const state = parseFilesPanelTransferPreparedState(prepared.state);
      expect(state, label).not.toBeNull();
      expect(state!.sourceDocumentId, label).toBe(document.id);
      expect(state!.targetDocumentId, label).not.toBe(document.id);
      expect(state!.targetSource, label).toEqual({
        documentId: state!.targetDocumentId,
        kind: "disk",
        path: PATH,
        root: ROOT,
      });
      expect(state!.view.mode, label).toBe("preview");
      expect(state!.view.selection, label).toEqual({ anchor: 1, head: 4 });
      expect(state!.view.scroll, label).toEqual({ left: 12, top: 34 });
      expect(JSON.stringify(prepared.state), label).not.toContain(
        "currentContents"
      );
      expect(JSON.stringify(prepared.state), label).not.toContain("# dirty");
      expect(JSON.stringify(prepared.state), label).not.toContain("# on disk");

      const staged = deps.drafts.get(mapping.sourceKey);
      expect(staged, label).toBeTruthy();
      const parsed = parsePersistedDiskDraft(staged!);
      expect(parsed?.id, label).toBe(state!.targetDocumentId);
      expect(deps.resumeTransferMutations, label).toHaveBeenCalled();
    }
  });

  it("prepares untitled drafts with a new untitled identity", async () => {
    const document = untitledDocument({ currentContents: "# hello" });
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    const prepared = await reg.prepareSource({
      panelId: "panel-u",
      params: {
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      transferId: TRANSFER_ID,
    });

    expect(prepared.drafts).toHaveLength(1);
    const state = parseFilesPanelTransferPreparedState(prepared.state)!;
    expect(state.targetSource.kind).toBe("untitled");
    if (state.targetSource.kind !== "untitled") {
      throw new Error("expected untitled");
    }
    expect(state.targetDocumentId).not.toBe(document.id);
    expect(state.targetSource.id).toBe(state.targetDocumentId);
    expect(JSON.stringify(prepared.state)).not.toContain("# hello");
  });

  it("returns drafts=[] for clean disk documents", async () => {
    const document = diskDocument({ dirty: false });
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    const prepared = await reg.prepareSource({
      panelId: "panel-clean",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: TRANSFER_ID,
    });

    expect(prepared.drafts).toEqual([]);
    const state = parseFilesPanelTransferPreparedState(prepared.state)!;
    expect(state.targetDocumentId).not.toBe(document.id);
    expect(state.originalDraftKey).toBeUndefined();
  });

  it("fails when untitled source document is missing", async () => {
    const deps = createDeps();
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    await expect(
      reg.prepareSource({
        panelId: "panel-missing",
        params: {
          source: {
            id: "pier.files.untitled:missing",
            kind: "untitled",
            name: "Untitled-1.md",
          },
        },
        transferId: TRANSFER_ID,
      })
    ).rejects.toThrow(/missing/i);
    expect(deps.resumeTransferMutations).toHaveBeenCalled();
  });

  it("stages dual dirty same-path targets with explicit document ids", async () => {
    const source = diskDocument({
      currentContents: "# source dirty",
      dirty: true,
    });
    const existingTargetId = allocateExplicitDiskDocumentId();
    const existingTarget = diskDocument({
      currentContents: "# already open dirty",
      dirty: true,
      id: existingTargetId,
    });

    const deps = createDeps({
      documents: new Map([
        [source.id, source],
        [existingTargetId, existingTarget],
      ]),
    });
    // Force a distinct allocated id
    let allocated = existingTargetId;
    deps.allocateExplicitDiskDocumentId = () => {
      allocated = allocateExplicitDiskDocumentId();
      return allocated;
    };

    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    const prepared = await reg.prepareSource({
      panelId: "panel-dual",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: TRANSFER_ID,
    });
    const state = parseFilesPanelTransferPreparedState(prepared.state)!;
    expect(state.targetDocumentId).toBe(allocated);
    expect(state.targetDocumentId).not.toBe(source.id);
    expect(state.targetDocumentId).not.toBe(existingTargetId);

    // Simulate main stageTransfer copy into target key
    const mapping = prepared.drafts![0]!;
    deps.drafts.set(mapping.targetKey, deps.drafts.get(mapping.sourceKey)!);

    const stage = await reg.stageTarget({
      panelId: "panel-dual",
      params: {},
      prepared,
      transferId: TRANSFER_ID,
    });
    expect(stage?.params?.source).toEqual({
      documentId: state.targetDocumentId,
      kind: "disk",
      path: PATH,
      root: ROOT,
    });
    expect(deps.getDocument(state.targetDocumentId)?.currentContents).toBe(
      "# source dirty"
    );
    expect(deps.getDocument(existingTargetId)?.currentContents).toBe(
      "# already open dirty"
    );

    // Opening the default path id still hits the original, not the migrated copy.
    const defaultOpen = deps.ensureDiskDocument({ path: PATH, root: ROOT });
    expect(defaultOpen.id).toBe(source.id);
    expect(defaultOpen.id).not.toBe(state.targetDocumentId);
  });

  it("does not delete the source draft when a second tab still references it", async () => {
    const document = diskDocument({
      currentContents: "# keep",
      dirty: true,
    });
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    await reg.prepareSource({
      panelId: "panel-a",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: TRANSFER_ID,
    });
    const originalKey = diskDraftStorageKey(document.id);
    deps.drafts.set(originalKey, JSON.stringify({ id: document.id }));

    await reg.releaseSource?.({
      panelId: "panel-a",
      remainingParams: [{ source: { kind: "disk", path: PATH, root: ROOT } }],
      transferId: TRANSFER_ID,
    });

    expect(deps.drafts.has(originalKey)).toBe(true);
  });

  it("removes the original draft when no remaining panel references the source", async () => {
    const document = diskDocument({
      currentContents: "# drop",
      dirty: true,
    });
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    await reg.prepareSource({
      panelId: "panel-a",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: TRANSFER_ID,
    });
    const originalKey = diskDraftStorageKey(document.id);
    deps.drafts.set(originalKey, "x");

    await reg.releaseSource?.({
      panelId: "panel-a",
      remainingParams: [],
      transferId: TRANSFER_ID,
    });

    expect(deps.drafts.has(originalKey)).toBe(false);
  });

  it("restores source editability after abort and removes hydrated target", async () => {
    const document = diskDocument({
      currentContents: "# abort me",
      dirty: true,
    });
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }

    const prepared = await reg.prepareSource({
      panelId: "panel-abort",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: TRANSFER_ID,
    });
    const state = parseFilesPanelTransferPreparedState(prepared.state)!;
    const mapping = prepared.drafts![0]!;
    deps.drafts.set(mapping.targetKey, deps.drafts.get(mapping.sourceKey)!);

    await reg.stageTarget({
      panelId: "panel-abort",
      params: {},
      prepared,
      transferId: TRANSFER_ID,
    });
    expect(deps.getDocument(state.targetDocumentId)).not.toBeNull();

    await reg.finalize({
      outcome: "abort",
      panelId: "panel-abort",
      role: "target",
      transferId: TRANSFER_ID,
    });
    expect(deps.discardDocument).toHaveBeenCalledWith(state.targetDocumentId);

    // Source-side abort clears barriers / bookkeeping (editability restored).
    const sourceDeps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const sourceReg = createFilesPanelTransferRegistration(sourceDeps);
    if (sourceReg.kind !== "custom") {
      throw new Error("expected custom");
    }
    await sourceReg.prepareSource({
      panelId: "panel-abort-source",
      params: { source: { kind: "disk", path: PATH, root: ROOT } },
      transferId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    await sourceReg.finalize({
      outcome: "abort",
      panelId: "panel-abort-source",
      role: "source",
      transferId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(sourceDeps.resumeTransferMutations).toHaveBeenCalled();
  });

  it("fails stageTarget when untitled draft is missing", async () => {
    const document = untitledDocument();
    const deps = createDeps({
      documents: new Map([[document.id, document]]),
    });
    const reg = createFilesPanelTransferRegistration(deps);
    if (reg.kind !== "custom") {
      throw new Error("expected custom");
    }
    const prepared = await reg.prepareSource({
      panelId: "panel-u2",
      params: {
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      transferId: TRANSFER_ID,
    });
    // Main copy never happened — target key absent
    deps.drafts.clear();

    await expect(
      reg.stageTarget({
        panelId: "panel-u2",
        params: {},
        prepared,
        transferId: TRANSFER_ID,
      })
    ).rejects.toThrow(/missing/i);
  });

  it("seeds view state for the target panel", async () => {
    seedFilesPanelView({
      documentId: "doc-1",
      panelId: "panel-seed",
      view: {
        mode: "diff",
        scroll: { left: 9, top: 8 },
        selection: { anchor: 2, head: 5 },
      },
    });
    const taken = takeFilesPanelViewSeed({ panelId: "panel-seed" });
    expect(taken).toEqual({
      mode: "diff",
      scroll: { left: 9, top: 8 },
      selection: { anchor: 2, head: 5 },
    });
    expect(takeFilesPanelViewSeed({ panelId: "panel-seed" })).toBeNull();
  });

  it("coerces legacy rich transfer view mode to source", () => {
    const parsed = parseFilesPanelTransferPreparedState({
      sourceDocumentId: "doc-a",
      targetDocumentId: "doc-b",
      targetSource: { kind: "disk", path: PATH, root: ROOT },
      view: { mode: "rich" },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.view.mode).toBe("source");
  });
});

describe("FilesMutationSuspendCoordinator", () => {
  it("drains shared in-flight ops for transfer scopes without blocking other documents", async () => {
    const gate = new FilesMutationGate();
    const coordinator = new FilesMutationSuspendCoordinator(gate);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inFlight = gate.run(async () => {
      await pending;
      return "done";
    });

    const other = coordinator.run(async () => "other", {
      documentId: "doc-other",
    });

    const abort = new AbortController();
    const suspension = coordinator.suspend(
      { documentId: "doc-1", kind: "transfer", panelId: "panel-1" },
      abort.signal
    );

    await Promise.resolve();
    expect(coordinator.isSuspended({ documentId: "doc-1" })).toBe(false);
    release();
    await expect(inFlight).resolves.toBe("done");
    await suspension;
    expect(coordinator.isSuspended({ documentId: "doc-1" })).toBe(true);
    expect(coordinator.isSuspended({ documentId: "doc-other" })).toBe(false);
    await expect(other).resolves.toBe("other");

    await expect(
      coordinator.run(async () => "blocked", { documentId: "doc-1" })
    ).rejects.toMatchObject({ name: "FilesMutationSuspendedError" });

    coordinator.resume({
      documentId: "doc-1",
      kind: "transfer",
      panelId: "panel-1",
    });
    await expect(
      coordinator.run(async () => "ok", { documentId: "doc-1" })
    ).resolves.toBe("ok");
  });

  it("lets global all override transfer scopes and serializes suspends", async () => {
    const gate = new FilesMutationGate();
    const coordinator = new FilesMutationSuspendCoordinator(gate);
    const abort = new AbortController();

    await coordinator.suspend(
      { documentId: "doc-1", kind: "transfer", panelId: "p1" },
      abort.signal
    );
    await coordinator.suspend({ kind: "all" }, abort.signal);

    expect(coordinator.isSuspended()).toBe(true);
    expect(coordinator.isSuspended({ documentId: "doc-other" })).toBe(true);

    coordinator.resume({ kind: "all" });
    // transfer scope still recorded
    expect(coordinator.isSuspended({ documentId: "doc-1" })).toBe(true);
    expect(coordinator.isSuspended({ documentId: "doc-other" })).toBe(false);
  });
});
