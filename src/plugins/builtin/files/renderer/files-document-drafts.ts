import type {
  FilesDocument,
  FilesDocumentOrigin,
} from "./files-document-types.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";

export const UNTITLED_DOCUMENT_ID_PREFIX = "pier.files.untitled:";
const UNTITLED_DRAFT_STORAGE_PREFIX = "pier.files.untitledDraft:";
const DISK_DRAFT_STORAGE_PREFIX = "pier.files.diskDraft:";
const DELETED_DRAFT_VALUE = "__pier_files_deleted_draft_v1__";

export interface PersistedUntitledDocument {
  currentContents: string;
  dirty: boolean;
  id: string;
  name: string;
  origin?: FilesDocumentOrigin;
  savedContents: string;
}

export interface PersistedDiskDraft {
  baseMtimeMs: number | null;
  currentContents: string;
  id: string;
  path: string;
  root: string;
  savedContents: string;
}

export interface FilesDraftBackend {
  delete(key: string): Promise<void>;
  list(): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
}

let draftBackend: FilesDraftBackend | null = null;
const hydratedDrafts = new Map<string, string>();
let draftsHydrated = false;

function draftStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readDraftValue(key: string): string | null {
  if (hydratedDrafts.has(key)) {
    const value = hydratedDrafts.get(key) ?? null;
    return value === DELETED_DRAFT_VALUE ? null : value;
  }
  if (draftBackend && draftsHydrated) {
    return null;
  }
  const value = draftStorage()?.getItem(key) ?? null;
  return value === DELETED_DRAFT_VALUE ? null : value;
}

function writeDraftValue(key: string, value: string): void {
  if (readDraftValue(key) === value) {
    return;
  }
  hydratedDrafts.set(key, value);
  if (draftBackend) {
    draftBackend.set(key, value).catch(() => {
      draftStorage()?.setItem(key, value);
    });
    return;
  }
  draftStorage()?.setItem(key, value);
}

function deleteDraftValue(key: string): void {
  if (draftBackend) {
    hydratedDrafts.set(key, DELETED_DRAFT_VALUE);
    draftBackend
      .delete(key)
      .then(() => {
        if (hydratedDrafts.get(key) === DELETED_DRAFT_VALUE) {
          hydratedDrafts.delete(key);
        }
        draftStorage()?.removeItem(key);
      })
      .catch(() => {
        draftStorage()?.setItem(key, DELETED_DRAFT_VALUE);
      });
    return;
  }
  hydratedDrafts.delete(key);
  draftStorage()?.removeItem(key);
}

function draftKeysWithPrefix(prefix: string): string[] {
  const keys = new Set<string>();
  for (const key of hydratedDrafts.keys()) {
    if (key.startsWith(prefix)) {
      keys.add(key);
    }
  }
  const storage = draftStorage();
  if (storage && !(draftBackend && draftsHydrated)) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function isDraftStorageKey(key: string | null): key is string {
  return (
    key?.startsWith(UNTITLED_DRAFT_STORAGE_PREFIX) === true ||
    key?.startsWith(DISK_DRAFT_STORAGE_PREFIX) === true
  );
}

function hydrateBackendDrafts(persisted: Record<string, string>): void {
  for (const [key, value] of Object.entries(persisted)) {
    if (!hydratedDrafts.has(key)) {
      hydratedDrafts.set(key, value);
    }
  }
}

function retryBackendDeleteForTombstone(
  backend: FilesDraftBackend,
  key: string,
  storage: Storage
): void {
  hydratedDrafts.set(key, DELETED_DRAFT_VALUE);
  backend
    .delete(key)
    .then(() => {
      if (hydratedDrafts.get(key) === DELETED_DRAFT_VALUE) {
        hydratedDrafts.delete(key);
      }
      storage.removeItem(key);
    })
    .catch(() => undefined);
}

function migrateLocalDraftsToBackend(backend: FilesDraftBackend): void {
  const storage = draftStorage();
  if (!storage) {
    return;
  }
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!isDraftStorageKey(key)) {
      continue;
    }
    const value = storage.getItem(key);
    if (value === DELETED_DRAFT_VALUE) {
      retryBackendDeleteForTombstone(backend, key, storage);
      continue;
    }
    if (value !== null) {
      hydratedDrafts.set(key, value);
      backend.set(key, value).catch(() => undefined);
    }
    storage.removeItem(key);
  }
}

export async function configureFilesDraftBackend(
  backend: FilesDraftBackend
): Promise<boolean> {
  try {
    const persisted = await backend.list();
    hydrateBackendDrafts(persisted);
    migrateLocalDraftsToBackend(backend);
    draftBackend = backend;
    draftsHydrated = true;
    return true;
  } catch {
    draftBackend = null;
    draftsHydrated = false;
    return false;
  }
}

export function resetFilesDraftBackendForTests(): void {
  draftBackend = null;
  draftsHydrated = false;
  hydratedDrafts.clear();
}

function untitledDraftStorageKey(documentId: string): string {
  return `${UNTITLED_DRAFT_STORAGE_PREFIX}${documentId}`;
}

function diskDraftStorageKey(root: string, path: string): string {
  return `${DISK_DRAFT_STORAGE_PREFIX}${stableFileIdentityHash(`${root}\0${path}`)}`;
}

export function isUntitledDocumentId(documentId: string): boolean {
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

function isPersistedDiskDraft(value: unknown): value is PersistedDiskDraft {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.currentContents === "string" &&
    typeof record.id === "string" &&
    typeof record.path === "string" &&
    typeof record.root === "string" &&
    typeof record.savedContents === "string" &&
    (record.baseMtimeMs === null || typeof record.baseMtimeMs === "number")
  );
}

export function readPersistedUntitledDocument(
  documentId: string
): PersistedUntitledDocument | null {
  const rawValue = readDraftValue(untitledDraftStorageKey(documentId));
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

export function hasPersistedUntitledDocument(documentId: string): boolean {
  return readPersistedUntitledDocument(documentId) !== null;
}

export function persistUntitledDocument(document: FilesDocument): void {
  if (document.source.kind !== "untitled") {
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
  writeDraftValue(
    untitledDraftStorageKey(document.id),
    JSON.stringify(persisted)
  );
}

export function removePersistedUntitledDocument(documentId: string): void {
  deleteDraftValue(untitledDraftStorageKey(documentId));
}

export function clearPersistedUntitledDocuments(): void {
  for (const key of draftKeysWithPrefix(UNTITLED_DRAFT_STORAGE_PREFIX)) {
    deleteDraftValue(key);
  }
}

export function persistDiskDraft(document: FilesDocument): void {
  if (document.source.kind !== "disk" || !document.dirty) {
    return;
  }
  const persisted: PersistedDiskDraft = {
    baseMtimeMs: document.baseMtimeMs,
    currentContents: document.currentContents,
    id: document.id,
    path: document.source.path,
    root: document.source.root,
    savedContents: document.savedContents,
  };
  writeDraftValue(
    diskDraftStorageKey(document.source.root, document.source.path),
    JSON.stringify(persisted)
  );
}

export function removePersistedDiskDraft(root: string, path: string): void {
  deleteDraftValue(diskDraftStorageKey(root, path));
}

export function readPersistedDiskDraft(
  root: string,
  path: string
): PersistedDiskDraft | null {
  const rawValue = readDraftValue(diskDraftStorageKey(root, path));
  if (!rawValue) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isPersistedDiskDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPersistedDiskDrafts(): void {
  for (const key of draftKeysWithPrefix(DISK_DRAFT_STORAGE_PREFIX)) {
    deleteDraftValue(key);
  }
}
