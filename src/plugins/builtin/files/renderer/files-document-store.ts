import { useSyncExternalStore } from "react";
import type {
  FilesDocument,
  FilesDocumentCapability,
  FilesDocumentLanguage,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
  FilesDocumentSource,
} from "./files-document-types.ts";

const documents = new Map<string, FilesDocument>();
const listeners = new Set<() => void>();

const DISK_TEXT_CAPABILITIES = [
  "save",
] satisfies readonly FilesDocumentCapability[];
const TEMPORARY_MARKDOWN_CAPABILITIES =
  [] satisfies readonly FilesDocumentCapability[];

const HASH_MULTIPLIER = 33;
const HASH_MODULUS = 2_147_483_647;
const HASH_SEED = 5381;
const UNTITLED_DOCUMENT_ID_PREFIX = "pier.files.untitled:";
const UNTITLED_DRAFT_STORAGE_PREFIX = "pier.files.untitledDraft:";

interface PersistedUntitledDocument {
  currentContents: string;
  dirty: boolean;
  id: string;
  name: string;
  origin?: FilesDocumentOrigin;
  savedContents: string;
}

let nextUntitledIndex = 1;
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

function draftStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function draftStorageKey(documentId: string): string {
  return `${UNTITLED_DRAFT_STORAGE_PREFIX}${documentId}`;
}

function isUntitledDocumentId(documentId: string): boolean {
  return documentId.startsWith(UNTITLED_DOCUMENT_ID_PREFIX);
}

function isFilesDocumentOrigin(value: unknown): value is FilesDocumentOrigin {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.source === "project-file-tree" ||
      record.source === "terminal-selection") &&
    (record.panelId === undefined || typeof record.panelId === "string")
  );
}

function isPersistedUntitledDocument(
  value: unknown
): value is PersistedUntitledDocument {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.currentContents === "string" &&
    typeof record.dirty === "boolean" &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.savedContents === "string" &&
    (record.origin === undefined || isFilesDocumentOrigin(record.origin))
  );
}

function readPersistedUntitledDocument(
  documentId: string
): PersistedUntitledDocument | null {
  const storage = draftStorage();
  if (!storage) {
    return null;
  }

  const rawValue = storage.getItem(draftStorageKey(documentId));
  if (!rawValue) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isPersistedUntitledDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasPersistedUntitledDocument(documentId: string): boolean {
  return readPersistedUntitledDocument(documentId) !== null;
}

function persistUntitledDocument(document: FilesDocument): void {
  if (document.source.kind !== "untitled") {
    return;
  }
  const storage = draftStorage();
  if (!storage) {
    return;
  }

  const persisted: PersistedUntitledDocument = {
    currentContents: document.currentContents,
    dirty: document.dirty,
    id: document.id,
    name: document.name,
    ...(document.source.origin ? { origin: document.source.origin } : {}),
    savedContents: document.savedContents,
  };
  storage.setItem(draftStorageKey(document.id), JSON.stringify(persisted));
}

function removePersistedUntitledDocument(documentId: string): void {
  draftStorage()?.removeItem(draftStorageKey(documentId));
}

function clearPersistedUntitledDocuments(): void {
  const storage = draftStorage();
  if (!storage) {
    return;
  }

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(UNTITLED_DRAFT_STORAGE_PREFIX)) {
      storage.removeItem(key);
    }
  }
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
  while (documents.has(id) || hasPersistedUntitledDocument(id)) {
    index += 1;
    id = `${UNTITLED_DOCUMENT_ID_PREFIX}${index}`;
  }
  nextUntitledIndex = index + 1;
  return { id, index, name: `Untitled-${index}.md` };
}

function stableHash(input: string): string {
  let hash = HASH_SEED;

  for (const character of input) {
    hash =
      (hash * HASH_MULTIPLIER + (character.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }

  return hash.toString(36);
}

function diskDocumentId(root: string, path: string): string {
  return `pier.files.file:${stableHash(`${root}\0${path}`)}`;
}

function languageForPath(path: string): FilesDocumentLanguage {
  const normalizedPath = path.toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown")
    ? "markdown"
    : "text";
}

function nameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function createUntitledSource(input: {
  id: string;
  name: string;
  origin?: FilesDocumentOrigin;
}): FilesDocumentSource {
  if (input.origin) {
    return {
      id: input.id,
      kind: "untitled",
      language: "markdown",
      name: input.name,
      origin: input.origin,
    };
  }

  return {
    id: input.id,
    kind: "untitled",
    language: "markdown",
    name: input.name,
  };
}

function replaceDocument(
  documentId: string,
  update: (document: FilesDocument) => FilesDocument
): void {
  const document = documents.get(documentId);
  if (!document) {
    return;
  }

  const nextDocument = update(document);
  if (nextDocument === document) {
    return;
  }

  documents.set(documentId, nextDocument);
  persistUntitledDocument(nextDocument);
  notify();
}

export function createUntitledMarkdownDocument(input: {
  contents: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument {
  const { id, name } = nextUntitledIdentity();
  const document: FilesDocument = {
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: input.contents,
    dirty: false,
    error: null,
    id,
    language: "markdown",
    loadState: "loaded",
    name,
    readOnly: false,
    savedContents: input.contents,
    source: input.origin
      ? createUntitledSource({ id, name, origin: input.origin })
      : createUntitledSource({ id, name }),
  };

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
    return existingDocument;
  }

  const persisted = readPersistedUntitledDocument(source.id);
  if (!persisted) {
    return null;
  }

  const name = persisted.name || source.name;
  const document: FilesDocument = {
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: persisted.currentContents,
    dirty: persisted.dirty,
    error: null,
    id: source.id,
    language: "markdown",
    loadState: "loaded",
    name,
    readOnly: false,
    savedContents: persisted.savedContents,
    source: persisted.origin
      ? createUntitledSource({ id: source.id, name, origin: persisted.origin })
      : createUntitledSource({ id: source.id, name }),
  };

  documents.set(source.id, document);
  syncNextUntitledIndexFromId(source.id);
  notify();
  return document;
}

export function ensureDiskDocument(input: {
  name?: string;
  path: string;
  root: string;
}): FilesDocument {
  const id = diskDocumentId(input.root, input.path);
  const existingDocument = documents.get(id);
  if (existingDocument) {
    return existingDocument;
  }

  const document: FilesDocument = {
    capabilities: DISK_TEXT_CAPABILITIES,
    currentContents: "",
    dirty: false,
    error: null,
    id,
    language: languageForPath(input.path),
    loadState: "idle",
    name: input.name ?? nameFromPath(input.path),
    readOnly: false,
    savedContents: "",
    source: { kind: "disk", path: input.path, root: input.root },
  };

  documents.set(id, document);
  notify();
  return document;
}

export function getDocument(documentId: string): FilesDocument | null {
  return documents.get(documentId) ?? null;
}

export function getDocumentForPanelSource(
  source: FilesDocumentPanelSource
): FilesDocument | null {
  if (source.kind === "untitled") {
    return getDocument(source.id);
  }
  return getDocument(diskDocumentId(source.root, source.path));
}

export function updateDocumentContents(
  documentId: string,
  contents: string
): void {
  replaceDocument(documentId, (document) => {
    if (document.currentContents === contents) {
      return document;
    }

    return {
      ...document,
      currentContents: contents,
      dirty: true,
    };
  });
}

export function markDocumentLoading(documentId: string): void {
  replaceDocument(documentId, (document) => {
    if (document.source.kind !== "disk" || document.loadState !== "idle") {
      return document;
    }

    return {
      ...document,
      error: null,
      loadState: "loading",
    };
  });
}

export function markDocumentLoaded(documentId: string, contents: string): void {
  replaceDocument(documentId, (document) => ({
    ...document,
    currentContents: contents,
    dirty: false,
    error: null,
    loadState: "loaded",
    savedContents: contents,
  }));
}

export function markDocumentSaved(
  documentId: string,
  savedContents: string
): void {
  replaceDocument(documentId, (document) => {
    const dirty = document.currentContents !== savedContents;
    if (
      document.savedContents === savedContents &&
      document.dirty === dirty &&
      document.error === null
    ) {
      return document;
    }

    return {
      ...document,
      dirty,
      error: null,
      savedContents,
    };
  });
}

export function markDocumentError(documentId: string, message: string): void {
  replaceDocument(documentId, (document) => ({
    ...document,
    error: message,
    loadState: "error",
  }));
}

export function markDocumentSaveError(
  documentId: string,
  message: string
): void {
  replaceDocument(documentId, (document) => ({
    ...document,
    dirty: true,
    error: message,
    loadState: document.loadState === "loading" ? "loading" : "loaded",
  }));
}

export function removeDocument(documentId: string): void {
  if (isUntitledDocumentId(documentId)) {
    removePersistedUntitledDocument(documentId);
  }
  if (!documents.delete(documentId)) {
    return;
  }

  notify();
}

export function clearFilesDocumentStore(
  options: { persisted?: boolean } = {}
): void {
  documents.clear();
  if (options.persisted !== false) {
    clearPersistedUntitledDocuments();
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

export function useFilesDocument(documentId: string): FilesDocument | null {
  useSyncExternalStore(
    subscribeFilesDocumentStore,
    getFilesDocumentStoreRevision,
    getFilesDocumentStoreRevision
  );
  return getDocument(documentId);
}
