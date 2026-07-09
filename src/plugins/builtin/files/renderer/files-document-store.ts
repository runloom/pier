import {
  clearPersistedDiskDrafts,
  clearPersistedUntitledDocuments,
  configureFilesDraftBackend as configureDraftBackend,
  type FilesDraftBackend,
  hasPersistedUntitledDocument,
  isUntitledDocumentId,
  persistDiskDraft,
  persistUntitledDocument,
  readPersistedDiskDraft,
  readPersistedUntitledDocument,
  removePersistedDiskDraft,
  removePersistedUntitledDocument,
  resetFilesDraftBackendForTests as resetDraftBackendForTests,
  UNTITLED_DOCUMENT_ID_PREFIX,
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
import {
  withDocumentConflictContents,
  withDocumentContents,
  withDocumentDiskConflict,
  withDocumentError,
  withDocumentLoaded,
  withDocumentLoading,
  withDocumentSaved,
  withDocumentSaveError,
  withDocumentSaveIdle,
  withDocumentSaving,
} from "./files-document-reducers.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";

const documents = new Map<string, FilesDocument>();
const documentAliases = new Map<string, string>();
const pendingUntitledRestores = new Map<string, PendingUntitledRestoreSource>();
const listeners = new Set<() => void>();

let nextUntitledIndex = 1;
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export async function configureFilesDraftBackend(
  backend: FilesDraftBackend
): Promise<void> {
  if (await configureDraftBackend(backend)) {
    applyHydratedDraftsToOpenDocuments({
      documents,
      pendingUntitledRestores,
      syncNextUntitledIndexFromId,
    });
    notify();
  }
}

export function resetFilesDraftBackendForTests(): void {
  resetDraftBackendForTests();
}

function syncNextUntitledIndexFromId(documentId: string): void {
  if (!isUntitledDocumentId(documentId)) {
    return;
  }
  const suffix = documentId.slice(UNTITLED_DOCUMENT_ID_PREFIX.length);
  const index = Number.parseInt(suffix, 10);
  if (Number.isInteger(index) && index >= nextUntitledIndex) {
    nextUntitledIndex = index + 1;
  }
}

function nextUntitledIdentity(): { id: string; index: number; name: string } {
  let index = nextUntitledIndex;
  let id = `${UNTITLED_DOCUMENT_ID_PREFIX}${index}`;
  while (
    documents.has(id) ||
    pendingUntitledRestores.has(id) ||
    hasPersistedUntitledDocument(id)
  ) {
    index += 1;
    id = `${UNTITLED_DOCUMENT_ID_PREFIX}${index}`;
  }
  nextUntitledIndex = index + 1;
  return { id, index, name: `Untitled-${index}.md` };
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
    if (nextDocument.dirty) {
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
    syncNextUntitledIndexFromId(source.id);
    return null;
  }

  const name = persisted.name || source.name;
  const document = restoreUntitledMarkdownRecord({
    id: source.id,
    name,
    persisted,
  });

  documents.set(source.id, document);
  syncNextUntitledIndexFromId(source.id);
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

export function moveDiskDocumentSource(
  root: string,
  oldPath: string,
  newPath: string
): void {
  if (oldPath === newPath) {
    return;
  }

  const entries = listDiskDocumentsUnder(root, oldPath);
  if (entries.length === 0) {
    return;
  }

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
    removePersistedDiskDraft(root, previousPath);
    if (nextDocument.dirty) {
      persistDiskDraft(nextDocument);
    }
  }
  notify();
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

export function updateDocumentContents(
  documentId: string,
  contents: string
): void {
  replaceDocument(documentId, (document) =>
    withDocumentContents(document, contents)
  );
}

export function markDocumentLoading(documentId: string): void {
  replaceDocument(documentId, withDocumentLoading);
}

export function markDocumentLoaded(
  documentId: string,
  contents: string,
  baseMtimeMs: number | null = null
): void {
  replaceDocument(documentId, (document) =>
    withDocumentLoaded(document, contents, baseMtimeMs)
  );
}

export function markDocumentSaved(
  documentId: string,
  savedContents: string,
  baseMtimeMs?: number | null
): void {
  replaceDocument(documentId, (document) =>
    withDocumentSaved(document, savedContents, baseMtimeMs)
  );
}

export function markDocumentError(documentId: string, message: string): void {
  replaceDocument(documentId, (document) =>
    withDocumentError(document, message)
  );
}

export function markDocumentSaveError(
  documentId: string,
  message: string
): void {
  replaceDocument(documentId, (document) =>
    withDocumentSaveError(document, message)
  );
}

export function markDocumentSaving(documentId: string): void {
  replaceDocument(documentId, withDocumentSaving);
}

export function markDocumentSaveIdle(documentId: string): void {
  replaceDocument(documentId, withDocumentSaveIdle);
}

export function setDocumentConflictContents(
  documentId: string,
  contents: string | null
): void {
  replaceDocument(documentId, (document) =>
    withDocumentConflictContents(document, contents)
  );
}

export function markDocumentDiskConflict(documentId: string): void {
  replaceDocument(documentId, withDocumentDiskConflict);
}

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
  nextUntitledIndex = 1;
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
