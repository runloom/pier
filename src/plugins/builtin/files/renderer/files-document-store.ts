import {
  claimLegacyDraft,
  clearPersistedDiskDrafts,
  clearPersistedUntitledDocuments,
  configureFilesDraftBackend as configureDraftBackend,
  diskDraftHasRecoverableState,
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
  restoreUntitledMarkdownRecord,
} from "./files-document-factory.ts";
import {
  applyHydratedDraftsToOpenDocuments,
  type PendingUntitledRestoreSource,
} from "./files-document-hydration.ts";
import { createFilesDocumentPathMutationActions } from "./files-document-path-mutations.ts";
import { diskDocumentId } from "./files-document-paths.ts";
import { createFilesDocumentSaveAsActions } from "./files-document-save-as.ts";
import { createFilesDocumentStateActions } from "./files-document-state-actions.ts";
import {
  type FilesDocument,
  type FilesDocumentOrigin,
  type FilesDocumentPanelSource,
  resolveDiskDocumentId,
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
      : diskDraftStorageKey(resolveDiskDocumentId(source));
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
  path: string,
  documentId?: string | undefined
): { document: FilesDocument; id: string } | null {
  const directId = resolveDocumentId(documentId ?? diskDocumentId(root, path));
  const directDocument = documents.get(directId);
  if (directDocument?.source.kind === "disk") {
    return { document: directDocument, id: directId };
  }

  return null;
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
    if (diskDraftHasRecoverableState(nextDocument)) {
      persistDiskDraft(nextDocument);
    } else {
      removePersistedDiskDraft(nextDocument.id, {
        path: nextDocument.source.path,
        root: nextDocument.source.root,
      });
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
  documentId?: string | undefined;
  name?: string | undefined;
  path: string;
  root: string;
}): FilesDocument {
  const id = resolveDiskDocumentId(input);
  const existingEntry = findDiskDocumentEntry(input.root, input.path, id);
  if (existingEntry) {
    return existingEntry.document;
  }

  const draft = readPersistedDiskDraft(id, {
    path: input.path,
    root: input.root,
  });
  const document = createDiskDocumentRecord({
    draft,
    id,
    ...(input.name ? { name: input.name } : {}),
    path: input.path,
    root: input.root,
  });

  documents.set(id, document);
  if (diskDraftHasRecoverableState(document)) {
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
  return getDocument(resolveDiskDocumentId(source));
}

export function listOpenDiskDocuments(): FilesDocument[] {
  return [...documents.values()].filter(
    (document) => document.source.kind === "disk"
  );
}

export const { moveDiskDocumentSource, removeDiskDocumentForPath } =
  createFilesDocumentPathMutationActions({
    documentAliases,
    documents,
    notify,
    removeDocumentAliasesFor,
  });

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
    removePersistedDiskDraft(document.id, {
      path: document.source.path,
      root: document.source.root,
    });
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
