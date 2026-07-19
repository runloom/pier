import {
  CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX,
  DISK_DRAFT_STORAGE_PREFIX,
  diskDraftStorageKey,
  legacyDiskDraftStorageKey,
  type PersistedDiskDraft,
  type PersistedUntitledDocument,
  parsePersistedDiskDraft,
  parsePersistedUntitledDocument,
  serializeDiskDraft,
  serializeUntitledDocument,
  UNTITLED_DRAFT_STORAGE_PREFIX,
  untitledDraftStorageKey,
} from "./files-document-draft-records.ts";
import { diskDocumentId } from "./files-document-paths.ts";
import type { FilesDocument } from "./files-document-types.ts";
import {
  flushFilesDraftWrites,
  listFilesDraftRecords,
  persistFilesDraftRecord,
  readFilesDraftRecord,
  removeFilesDraftRecord,
  settleDraftIsolationFailure,
} from "./files-draft-client-store.ts";

let recoveryDiagnostics: string[] = [];

export {
  diskDraftHasRecoverableState,
  diskDraftStorageKey,
  isUntitledDocumentId,
  legacyDiskDraftStorageKey,
  type PersistedDiskDraft,
  type PersistedUntitledDocument,
  transferStagingDraftKey,
  UNTITLED_DOCUMENT_ID_PREFIX,
  untitledDraftStorageKey,
} from "./files-document-draft-records.ts";
export * from "./files-draft-client-store.ts";

export function readPersistedUntitledDocument(
  documentId: string
): PersistedUntitledDocument | null {
  const rawValue = readFilesDraftRecord(untitledDraftStorageKey(documentId));
  return rawValue ? parsePersistedUntitledDocument(rawValue) : null;
}

export function persistUntitledDocument(document: FilesDocument): void {
  const value = serializeUntitledDocument(document);
  if (value !== null) {
    persistFilesDraftRecord(untitledDraftStorageKey(document.id), value);
  }
}

export function removePersistedUntitledDocument(documentId: string): void {
  removeFilesDraftRecord(untitledDraftStorageKey(documentId));
}

export function clearPersistedUntitledDocuments(): void {
  for (const key of listFilesDraftRecords(UNTITLED_DRAFT_STORAGE_PREFIX)) {
    removeFilesDraftRecord(key);
  }
}

export function persistDiskDraft(document: FilesDocument): void {
  const value = serializeDiskDraft(document);
  if (value === null || document.source.kind !== "disk") {
    return;
  }
  const key = diskDraftStorageKey(document.id);
  persistFilesDraftRecord(key, value);
  if (
    document.id === diskDocumentId(document.source.root, document.source.path)
  ) {
    const legacyKey = legacyDiskDraftStorageKey(
      document.source.root,
      document.source.path
    );
    if (legacyKey !== key) {
      removeFilesDraftRecord(legacyKey);
    }
  }
}

export function removePersistedDiskDraft(
  documentId: string,
  locator?: { path: string; root: string }
): void {
  removeFilesDraftRecord(diskDraftStorageKey(documentId));
  if (locator && documentId === diskDocumentId(locator.root, locator.path)) {
    removeFilesDraftRecord(
      legacyDiskDraftStorageKey(locator.root, locator.path)
    );
  }
}

export function readPersistedDiskDraft(
  documentId: string,
  locator?: { path: string; root: string }
): PersistedDiskDraft | null {
  const rawValue = readFilesDraftRecord(diskDraftStorageKey(documentId));
  if (rawValue) {
    return parsePersistedDiskDraft(rawValue);
  }
  if (locator && documentId === diskDocumentId(locator.root, locator.path)) {
    const legacyRaw = readFilesDraftRecord(
      legacyDiskDraftStorageKey(locator.root, locator.path)
    );
    return legacyRaw ? parsePersistedDiskDraft(legacyRaw) : null;
  }
  return null;
}

export function clearPersistedDiskDrafts(): void {
  for (const key of listFilesDraftRecords(DISK_DRAFT_STORAGE_PREFIX)) {
    removeFilesDraftRecord(key);
  }
}

export async function quarantineCorruptDocumentDrafts(): Promise<void> {
  const diagnostics = listFilesDraftRecords(
    CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX
  ).map((key) => `Protected draft data remains isolated: ${key}`);
  for (const prefix of [
    UNTITLED_DRAFT_STORAGE_PREFIX,
    DISK_DRAFT_STORAGE_PREFIX,
  ]) {
    for (const key of listFilesDraftRecords(prefix)) {
      const raw = readFilesDraftRecord(key);
      if (!raw) continue;
      const valid = key.startsWith(UNTITLED_DRAFT_STORAGE_PREFIX)
        ? parsePersistedUntitledDocument(raw) !== null
        : parsePersistedDiskDraft(raw) !== null;
      if (valid) continue;
      const quarantineKey = `${CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX}${crypto.randomUUID()}`;
      let quarantineCommitted = false;
      try {
        persistFilesDraftRecord(
          quarantineKey,
          JSON.stringify({ isolatedAt: Date.now(), key, raw })
        );
        await flushFilesDraftWrites();
        quarantineCommitted = true;
        removeFilesDraftRecord(key);
        await flushFilesDraftWrites();
        diagnostics.push(
          `Protected draft data was isolated because it is invalid: ${key}`
        );
      } catch (error) {
        settleDraftIsolationFailure({
          discardQuarantine: !quarantineCommitted,
          originalKey: key,
          quarantineKey,
          raw,
        });
        diagnostics.push(
          `Protected draft data is invalid and could not be isolated: ${key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  recoveryDiagnostics = diagnostics;
}

export function consumeFilesDraftRecoveryDiagnostics(): readonly string[] {
  const diagnostics = recoveryDiagnostics;
  recoveryDiagnostics = [];
  return diagnostics;
}

export function resetFilesDraftRecoveryDiagnosticsForTests(): void {
  recoveryDiagnostics = [];
}
