import {
  type FileDocumentEol,
  type FileDocumentFormat,
  fileDocumentEolSchema,
  fileDocumentFormatSchema,
} from "@shared/contracts/file.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
} from "./files-document-types.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";

export const UNTITLED_DOCUMENT_ID_PREFIX = "pier.files.untitled:";
export const UNTITLED_DRAFT_STORAGE_PREFIX = "pier.files.untitledDraft:";
export const DISK_DRAFT_STORAGE_PREFIX = "pier.files.diskDraft:";
export const SAVE_AS_OPERATION_STORAGE_PREFIX = "pier.files.saveAsOperation:";
export const CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX =
  "pier.files.corruptDocumentDraft:";

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
  canonicalPath?: string | null;
  currentContents: string;
  dirty?: boolean;
  durabilityUnknown?: boolean;
  eol?: FileDocumentEol | null;
  format?: FileDocumentFormat | null;
  id: string;
  mode?: number | null;
  path: string;
  revision?: string | null;
  root: string;
  savedContents: string;
  size?: number | null;
}

export function untitledDraftStorageKey(documentId: string): string {
  return `${UNTITLED_DRAFT_STORAGE_PREFIX}${documentId}`;
}

export function diskDraftStorageKey(root: string, path: string): string {
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
    (record.baseMtimeMs === null || typeof record.baseMtimeMs === "number") &&
    (record.canonicalPath === undefined ||
      record.canonicalPath === null ||
      typeof record.canonicalPath === "string") &&
    (record.dirty === undefined || typeof record.dirty === "boolean") &&
    (record.durabilityUnknown === undefined ||
      typeof record.durabilityUnknown === "boolean") &&
    (record.eol === undefined ||
      record.eol === null ||
      fileDocumentEolSchema.safeParse(record.eol).success) &&
    (record.format === undefined ||
      record.format === null ||
      fileDocumentFormatSchema.safeParse(record.format).success) &&
    (record.mode === undefined ||
      record.mode === null ||
      (typeof record.mode === "number" && Number.isInteger(record.mode))) &&
    (record.revision === undefined ||
      record.revision === null ||
      typeof record.revision === "string") &&
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
    id: document.id,
    name: document.name,
    ...(document.source.origin ? { origin: document.source.origin } : {}),
    savedContents: document.savedContents,
  };
  return JSON.stringify(persisted);
}

export function serializeDiskDraft(document: FilesDocument): string | null {
  if (
    document.source.kind !== "disk" ||
    !(document.dirty || document.durabilityUnknown)
  ) {
    return null;
  }
  const persisted: PersistedDiskDraft = {
    baseMtimeMs: document.baseMtimeMs,
    canonicalPath: document.canonicalPath,
    currentContents: document.currentContents,
    dirty: document.dirty,
    durabilityUnknown: document.durabilityUnknown,
    eol: document.eol,
    format: document.format,
    id: document.id,
    mode: document.mode,
    path: document.source.path,
    revision: document.revision,
    root: document.source.root,
    savedContents: document.savedContents,
    size: document.size,
  };
  return JSON.stringify(persisted);
}
