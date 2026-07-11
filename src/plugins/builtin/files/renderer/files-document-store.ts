import {
  claimLegacyDraft,
  clearPersistedDiskDrafts,
  clearPersistedUntitledDocuments,
  configureFilesDraftBackend as configureDraftBackend,
  diskDraftStorageKey,
  type FilesDraftBackend,
  flushFilesDraftWrites,
  isUntitledDocumentId,
  persistDiskDraft,
  persistUntitledDocument,
  quarantineCorruptDocumentDrafts,
  readPersistedDiskDraft,
  readPersistedUntitledDocument,
  removePersistedDiskDraft,
  removePersistedUntitledDocument,
  resetFilesDraftBackendForTests as resetDraftBackendForTests,
  resetFilesDraftRecoveryDiagnosticsForTests,
  untitledDraftStorageKey,
} from "./files-document-drafts.ts";
import {
  createDiskDocumentRecord,
  createUntitledMarkdownRecord,
  renameDiskDocumentRecord,
  restoreUntitledMarkdownRecord,
} from "./files-document-factory.ts";
import {
  applyHydratedDraftsToOpenDocuments,
  type PendingUntitledRestoreSource,
} from "./files-document-hydration.ts";
import {
  diskDocumentId,
  isSamePathOrDescendant,
  rewriteDescendantPath,
} from "./files-document-paths.ts";
import { createFilesDocumentSaveAsActions } from "./files-document-save-as.ts";
import { createFilesDocumentStateActions } from "./files-document-state-actions.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";
import {
  nextUntitledIdentity as allocateUntitledIdentity,
  resetUntitledIdentityForTests,
  syncNextUntitledIndex,
} from "./files-untitled-identity.ts";

const documents = new Map<string, FilesDocument>();
const documentAliases = new Map<string, string>();
const pendingUntitledRestores = new Map<string, PendingUntitledRestoreSource>();
const listeners = new Set<() => void>();
let revision = 0;
function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}
export async function configureFilesDraftBackend(
  backend: FilesDraftBackend
): Promise<readonly string[]> {
  await configureDraftBackend(backend);
  await quarantineCorruptDocumentDrafts();
  const hydratedDocumentIds = applyHydratedDraftsToOpenDocuments({
    documents,
    pendingUntitledRestores,
    syncNextUntitledIndex,
  });
  notify();
  return hydratedDocumentIds;
}
export function resetFilesDraftBackendForTests(): void {
  resetDraftBackendForTests();
  resetFilesDraftRecoveryDiagnosticsForTests();
}
export async function claimLegacyDraftForPanelSource(
  source: FilesDocumentPanelSource
): Promise<boolean> {
  const key =
    source.kind === "untitled"
      ? untitledDraftStorageKey(source.id)
      : diskDraftStorageKey(source.root, source.path);
  if (!(await claimLegacyDraft(key))) {
    return false;
  }
  applyHydratedDraftsToOpenDocuments({
    documents,
    pendingUntitledRestores,
    syncNextUntitledIndex,
  });
  notify();
  return true;
}
function nextUntitledIdentity(): { id: string; index: number; name: string } {
  return allocateUntitledIdentity({
    idExists: (id) =>
      documents.has(id) ||
      pendingUntitledRestores.has(id) ||
      readPersistedUntitledDocument(id) !== null,
    nameExists: (name) =>
      [...documents.values()].some((document) => document.name === name) ||
      [...pendingUntitledRestores.values()].some(
        (source) => source.name === name
      ),
  });
}
function resolveDocumentId(documentId: string): string {
  let currentId = documentId;
  const seenIds = new Set<string>();
  while (true) {
    const nextId = documentAliases.get(currentId);
    if (!nextId || seenIds.has(currentId)) {
      return currentId;
    }
    seenIds.add(currentId);
    currentId = nextId;
  }
}

function removeDocumentAliasesFor(documentId: string): void {
  for (const aliasId of [...documentAliases.keys()]) {
    const targetId = documentAliases.get(aliasId);
    if (
      aliasId === documentId ||
      targetId === documentId ||
      resolveDocumentId(aliasId) === documentId
    ) {
      documentAliases.delete(aliasId);
    }
  }
}

function findDiskDocumentEntry(
  root: string,
  path: string
): { document: FilesDocument; id: string } | null {
  const directId = resolveDocumentId(diskDocumentId(root, path));
  const directDocument = documents.get(directId);
  if (
    directDocument?.source.kind === "disk" &&
    directDocument.source.root === root &&
    directDocument.source.path === path
  ) {
    return { document: directDocument, id: directId };
  }

  for (const [id, document] of documents) {
    if (
      document.source.kind === "disk" &&
      document.source.root === root &&
      document.source.path === path
    ) {
      return { document, id };
    }
  }

  return null;
}

function listDiskDocumentsUnder(
  root: string,
  path: string
): Array<{ document: FilesDocument; id: string }> {
  const matches: Array<{ document: FilesDocument; id: string }> = [];
  for (const [id, document] of documents) {
    if (
      document.source.kind === "disk" &&
      document.source.root === root &&
      isSamePathOrDescendant(document.source.path, path)
    ) {
      matches.push({ document, id });
    }
  }
  return matches;
}

function replaceDocument(
  documentId: string,
  update: (document: FilesDocument) => FilesDocument
): void {
  const resolvedDocumentId = resolveDocumentId(documentId);
  const document = documents.get(resolvedDocumentId);
  if (!document) {
    return;
  }

  const nextDocument = update(document);
  if (nextDocument === document) {
    return;
  }

  documents.set(resolvedDocumentId, nextDocument);
  persistUntitledDocument(nextDocument);
  if (nextDocument.source.kind === "disk") {
    if (nextDocument.dirty || nextDocument.durabilityUnknown) {
      persistDiskDraft(nextDocument);
    } else {
      removePersistedDiskDraft(
        nextDocument.source.root,
        nextDocument.source.path
      );
    }
  }
  notify();
}

export const {
  markDocumentDeletedOnDisk,
  markDocumentDiskConflict,
  markDocumentDurabilityConfirmed,
  markDocumentDurabilityError,
  markDocumentError,
  markDocumentLoaded,
  markDocumentLoading,
  markDocumentPathReconciled,
  markDocumentReadResult,
  markDocumentSaved,
  markDocumentSaveError,
  markDocumentSaveIdle,
  markDocumentSaving,
  markDocumentWritten,
  normalizeDocumentEol,
  setDocumentConflictContents,
  updateDocumentContents,
} = createFilesDocumentStateActions(replaceDocument);

export function createUntitledMarkdownDocument(input: {
  contents: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument {
  const { id, name } = nextUntitledIdentity();
  const document = createUntitledMarkdownRecord({
    contents: input.contents,
    id,
    name,
    ...(input.origin ? { origin: input.origin } : {}),
  });

  documents.set(id, document);
  persistUntitledDocument(document);
  notify();
  return document;
}

export async function preserveDiskDocumentAsUntitled(
  documentId: string
): Promise<FilesDocument> {
  const resolvedId = resolveDocumentId(documentId);
  const document = documents.get(resolvedId);
  if (!document) {
    throw new Error("The document is no longer open");
  }
  if (document.source.kind === "untitled") {
    return document;
  }
  const { id, name } = nextUntitledIdentity();
  const preserved = createUntitledMarkdownRecord({
    contents: document.currentContents,
    id,
    name,
    origin: { source: "project-file-tree" },
  });
  persistUntitledDocument(preserved);
  try {
    await flushFilesDraftWrites();
  } catch (error) {
    removePersistedUntitledDocument(id);
    throw error;
  }
  documents.delete(resolvedId);
  documents.set(id, preserved);
  documentAliases.set(resolvedId, id);
  notify();
  return preserved;
}

export function rollbackPreservedDiskDocument(input: {
  original: FilesDocument;
  preserved: FilesDocument;
  removeUntitledDraft: boolean;
}): void {
  documents.delete(input.preserved.id);
  removeDocumentAliasesFor(input.preserved.id);
  documents.set(input.original.id, input.original);
  if (input.removeUntitledDraft) {
    removePersistedUntitledDocument(input.preserved.id);
  }
  persistDiskDraft(input.original);
  notify();
}

export function restoreUntitledDocumentFromPanelSource(
  source: Extract<FilesDocumentPanelSource, { kind: "untitled" }>
): FilesDocument | null {
  const existingDocument = documents.get(source.id);
  if (existingDocument) {
    pendingUntitledRestores.delete(source.id);
    return existingDocument;
  }

  const persisted = readPersistedUntitledDocument(source.id);
  if (!persisted) {
    pendingUntitledRestores.set(source.id, source);
    syncNextUntitledIndex(source.id, source.name);
    return null;
  }

  const name = persisted.name || source.name;
  const document = restoreUntitledMarkdownRecord({
    id: source.id,
    name,
    persisted,
  });

  documents.set(source.id, document);
  syncNextUntitledIndex(source.id, name);
  pendingUntitledRestores.delete(source.id);
  notify();
  return document;
}

export function ensureDiskDocument(input: {
  name?: string;
  path: string;
  root: string;
}): FilesDocument {
  const existingEntry = findDiskDocumentEntry(input.root, input.path);
  if (existingEntry) {
    return existingEntry.document;
  }

  const id = diskDocumentId(input.root, input.path);
  const draft = readPersistedDiskDraft(input.root, input.path);
  const document = createDiskDocumentRecord({
    draft,
    id,
    ...(input.name ? { name: input.name } : {}),
    path: input.path,
    root: input.root,
  });

  documents.set(id, document);
  if (document.dirty) {
    persistDiskDraft(document);
  }
  notify();
  return document;
}

export function getDocument(documentId: string): FilesDocument | null {
  return documents.get(resolveDocumentId(documentId)) ?? null;
}

export function getDocumentForPanelSource(
  source: FilesDocumentPanelSource
): FilesDocument | null {
  if (source.kind === "untitled") {
    return getDocument(source.id);
  }
  return getDocument(diskDocumentId(source.root, source.path));
}

export function listOpenDiskDocuments(): FilesDocument[] {
  return [...documents.values()].filter(
    (document) => document.source.kind === "disk"
  );
}

export async function moveDiskDocumentSource(
  root: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  if (oldPath === newPath) {
    return;
  }

  const entries = listDiskDocumentsUnder(root, oldPath);
  if (entries.length === 0) {
    return;
  }

  const previousDraftPaths: string[] = [];
  for (const entry of entries) {
    if (entry.document.source.kind !== "disk") {
      continue;
    }
    const previousPath = entry.document.source.path;
    const nextPath = rewriteDescendantPath(previousPath, oldPath, newPath);
    const nextId = diskDocumentId(root, nextPath);
    const nextDocument = renameDiskDocumentRecord(entry.document, {
      id: nextId,
      path: nextPath,
      root,
    });

    if (entry.id !== nextId) {
      documents.delete(entry.id);
      documentAliases.set(entry.id, nextId);
    }
    documentAliases.set(diskDocumentId(root, previousPath), nextId);
    documents.set(nextId, nextDocument);
    if (nextDocument.dirty || nextDocument.durabilityUnknown) {
      persistDiskDraft(nextDocument);
      previousDraftPaths.push(previousPath);
    } else {
      removePersistedDiskDraft(root, previousPath);
    }
  }
  notify();
  if (previousDraftPaths.length > 0) {
    await flushFilesDraftWrites();
    for (const previousPath of previousDraftPaths) {
      removePersistedDiskDraft(root, previousPath);
    }
    await flushFilesDraftWrites();
  }
}

export function removeDiskDocumentForPath(root: string, path: string): void {
  const entries = listDiskDocumentsUnder(root, path);
  if (entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    if (entry.document.source.kind === "disk") {
      removePersistedDiskDraft(root, entry.document.source.path);
    }
    documents.delete(entry.id);
    removeDocumentAliasesFor(entry.id);
    removeDocumentAliasesFor(
      diskDocumentId(
        root,
        entry.document.source.kind === "disk"
          ? entry.document.source.path
          : path
      )
    );
  }
  notify();
}

export const { adoptDocumentSaveAsTarget } = createFilesDocumentSaveAsActions({
  getDocument,
  notify,
  setDocument: (documentId, document) => {
    documents.set(documentId, document);
  },
});

export function removeDocument(documentId: string): void {
  const resolvedDocumentId = resolveDocumentId(documentId);
  const document = documents.get(resolvedDocumentId);
  if (isUntitledDocumentId(documentId)) {
    pendingUntitledRestores.delete(documentId);
    removePersistedUntitledDocument(documentId);
  }
  if (isUntitledDocumentId(resolvedDocumentId)) {
    pendingUntitledRestores.delete(resolvedDocumentId);
    removePersistedUntitledDocument(resolvedDocumentId);
  }
  if (document?.source.kind === "disk") {
    removePersistedDiskDraft(document.source.root, document.source.path);
  }
  if (!documents.delete(resolvedDocumentId)) {
    return;
  }

  removeDocumentAliasesFor(documentId);
  removeDocumentAliasesFor(resolvedDocumentId);
  notify();
}

export function clearFilesDocumentStore(
  options: { persisted?: boolean } = {}
): void {
  documents.clear();
  documentAliases.clear();
  pendingUntitledRestores.clear();
  if (options.persisted !== false) {
    clearPersistedUntitledDocuments();
    clearPersistedDiskDrafts();
  }
  resetUntitledIdentityForTests();
  notify();
}

export function getFilesDocumentStoreRevision(): number {
  return revision;
}

export function subscribeFilesDocumentStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
