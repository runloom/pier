import {
  type FileDocumentEol,
  type FileDocumentFormat,
  fileDocumentEolSchema,
  fileDocumentFormatSchema,
} from "@shared/contracts/file.ts";
import { stableFileIdentityHash } from "./stable-hash.ts";
import type {
  FilesDocument,
  FilesDocumentLanguage,
  FilesDocumentOrigin,
} from "./types.ts";

export const UNTITLED_DOCUMENT_ID_PREFIX = "pier.files.untitled:";
export const UNTITLED_DRAFT_STORAGE_PREFIX = "pier.files.untitledDraft:";
export const DISK_DRAFT_STORAGE_PREFIX = "pier.files.diskDraft:";
export const TRANSFER_STAGING_DRAFT_STORAGE_PREFIX =
  "pier.files.transferStaging:";
export const SAVE_AS_OPERATION_STORAGE_PREFIX = "pier.files.saveAsOperation:";
export const CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX =
  "pier.files.corruptDocumentDraft:";

export interface PersistedUntitledDocument {
  currentContents: string;
  dirty: boolean;
  eol?: FileDocumentEol | null;
  format?: FileDocumentFormat | null;
  id: string;
  language?: FilesDocumentLanguage;
  name: string;
  origin?: FilesDocumentOrigin;
  savedContents: string;
  savedEol?: FileDocumentEol | null;
  savedFormat?: FileDocumentFormat | null;
}

export interface PersistedDiskDraft {
  baseMtimeMs: number | null;
  canonicalPath?: string | null;
  conflictDiskContents?: string | null;
  currentContents: string;
  deletedOnDisk?: boolean;
  dirty?: boolean;
  diskConflict?: boolean;
  durabilityUnknown?: boolean;
  eol?: FileDocumentEol | null;
  format?: FileDocumentFormat | null;
  id: string;
  language?: FilesDocumentLanguage;
  mode?: number | null;
  path: string;
  revision?: string | null;
  root: string;
  savedContents: string;
  savedEol?: FileDocumentEol | null;
  savedFormat?: FileDocumentFormat | null;
  size?: number | null;
}

export function untitledDraftStorageKey(documentId: string): string {
  return `${UNTITLED_DRAFT_STORAGE_PREFIX}${documentId}`;
}

export function diskDraftStorageKey(documentId: string): string {
  return `${DISK_DRAFT_STORAGE_PREFIX}${documentId}`;
}

export function legacyDiskDraftStorageKey(root: string, path: string): string {
  return `${DISK_DRAFT_STORAGE_PREFIX}${stableFileIdentityHash(`${root}\0${path}`)}`;
}

export function transferStagingDraftKey(
  transferId: string,
  originalDraftKey: string
): string {
  return `${TRANSFER_STAGING_DRAFT_STORAGE_PREFIX}${transferId}:${originalDraftKey}`;
}

export function isUntitledDocumentId(documentId: string): boolean {
  return documentId.startsWith(UNTITLED_DOCUMENT_ID_PREFIX);
}

export function diskDraftHasRecoverableState(document: FilesDocument): boolean {
  return (
    document.dirty ||
    document.durabilityUnknown ||
    document.diskConflict ||
    document.deletedOnDisk ||
    document.conflictDiskContents !== null ||
    document.languageOverridden === true
  );
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
    (record.origin === undefined || isFilesDocumentOrigin(record.origin)) &&
    (record.language === undefined || typeof record.language === "string") &&
    (record.eol === undefined ||
      record.eol === null ||
      fileDocumentEolSchema.safeParse(record.eol).success) &&
    (record.format === undefined ||
      record.format === null ||
      fileDocumentFormatSchema.safeParse(record.format).success) &&
    (record.savedEol === undefined ||
      record.savedEol === null ||
      fileDocumentEolSchema.safeParse(record.savedEol).success) &&
    (record.savedFormat === undefined ||
      record.savedFormat === null ||
      fileDocumentFormatSchema.safeParse(record.savedFormat).success)
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
    (record.baseMtimeMs === null || typeof record.baseMtimeMs === "number") &&
    (record.canonicalPath === undefined ||
      record.canonicalPath === null ||
      typeof record.canonicalPath === "string") &&
    (record.conflictDiskContents === undefined ||
      record.conflictDiskContents === null ||
      typeof record.conflictDiskContents === "string") &&
    (record.deletedOnDisk === undefined ||
      typeof record.deletedOnDisk === "boolean") &&
    (record.dirty === undefined || typeof record.dirty === "boolean") &&
    (record.diskConflict === undefined ||
      typeof record.diskConflict === "boolean") &&
    (record.durabilityUnknown === undefined ||
      typeof record.durabilityUnknown === "boolean") &&
    (record.eol === undefined ||
      record.eol === null ||
      fileDocumentEolSchema.safeParse(record.eol).success) &&
    (record.format === undefined ||
      record.format === null ||
      fileDocumentFormatSchema.safeParse(record.format).success) &&
    (record.language === undefined || typeof record.language === "string") &&
    (record.mode === undefined ||
      record.mode === null ||
      (typeof record.mode === "number" && Number.isInteger(record.mode))) &&
    (record.revision === undefined ||
      record.revision === null ||
      typeof record.revision === "string") &&
    (record.savedEol === undefined ||
      record.savedEol === null ||
      fileDocumentEolSchema.safeParse(record.savedEol).success) &&
    (record.savedFormat === undefined ||
      record.savedFormat === null ||
      fileDocumentFormatSchema.safeParse(record.savedFormat).success) &&
    (record.size === undefined ||
      record.size === null ||
      (typeof record.size === "number" && record.size >= 0))
  );
}

export function parsePersistedUntitledDocument(
  rawValue: string
): PersistedUntitledDocument | null {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isPersistedUntitledDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePersistedDiskDraft(
  rawValue: string
): PersistedDiskDraft | null {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isPersistedDiskDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeUntitledDocument(
  document: FilesDocument
): string | null {
  if (document.source.kind !== "untitled") {
    return null;
  }
  const persisted: PersistedUntitledDocument = {
    currentContents: document.currentContents,
    dirty: document.dirty,
    eol: document.eol,
    format: document.format,
    id: document.id,
    language: document.language,
    name: document.name,
    ...(document.source.origin ? { origin: document.source.origin } : {}),
    savedContents: document.savedContents,
    savedEol: document.savedEol,
    savedFormat: document.savedFormat,
  };
  return JSON.stringify(persisted);
}

export function serializeDiskDraft(document: FilesDocument): string | null {
  if (
    document.source.kind !== "disk" ||
    !diskDraftHasRecoverableState(document)
  ) {
    return null;
  }
  const persisted: PersistedDiskDraft = {
    baseMtimeMs: document.baseMtimeMs,
    canonicalPath: document.canonicalPath,
    conflictDiskContents: document.conflictDiskContents,
    currentContents: document.currentContents,
    deletedOnDisk: document.deletedOnDisk,
    dirty: document.dirty,
    diskConflict: document.diskConflict,
    durabilityUnknown: document.durabilityUnknown,
    eol: document.eol,
    format: document.format,
    id: document.id,
    language: document.language,
    mode: document.mode,
    path: document.source.path,
    revision: document.revision,
    root: document.source.root,
    savedContents: document.savedContents,
    savedEol: document.savedEol,
    savedFormat: document.savedFormat,
    size: document.size,
  };
  return JSON.stringify(persisted);
}
