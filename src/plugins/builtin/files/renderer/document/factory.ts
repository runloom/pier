import type {
  FileDocumentFormat,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import { languageForPath } from "../editor/language-detection.ts";
import { computeDocumentDirty } from "./disk-protection.ts";
import type {
  PersistedDiskDraft,
  PersistedUntitledDocument,
} from "./drafts.ts";
import type {
  FilesDocument,
  FilesDocumentCapability,
  FilesDocumentLanguage,
  FilesDocumentOrigin,
  FilesDocumentSource,
} from "./types.ts";

const DISK_TEXT_CAPABILITIES = [
  "save",
  "saveAs",
] satisfies readonly FilesDocumentCapability[];
const TEMPORARY_MARKDOWN_CAPABILITIES = [
  "saveAs",
] satisfies readonly FilesDocumentCapability[];

function nameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function createUntitledSource(input: {
  id: string;
  language: FilesDocumentLanguage;
  name: string;
  origin?: FilesDocumentOrigin;
}): FilesDocumentSource {
  if (input.origin) {
    return {
      id: input.id,
      kind: "untitled",
      language: input.language,
      name: input.name,
      origin: input.origin,
    };
  }
  return {
    id: input.id,
    kind: "untitled",
    language: input.language,
    name: input.name,
  };
}

export function createUntitledRecord(input: {
  contents: string;
  eol?: FileWritableDocumentEol;
  format?: FileDocumentFormat;
  id: string;
  language: FilesDocumentLanguage;
  name: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument {
  const eol = input.eol ?? "lf";
  const format = input.format ?? { bom: false, encoding: "utf8" };
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    createdEmptyEol: null,
    currentContents: input.contents,
    deletedOnDisk: false,
    dirty: false,
    durabilityUnknown: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    eol,
    format,
    hasBackingStore: false,
    id: input.id,
    language: input.language,
    loadState: "loaded",
    mode: null,
    mime: null,
    name: input.name,
    needsSaveAs: true,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle",
    savedContents: input.contents,
    savedEol: eol,
    savedFormat: format,
    size: null,
    source: input.origin
      ? createUntitledSource({
          id: input.id,
          language: input.language,
          name: input.name,
          origin: input.origin,
        })
      : createUntitledSource({
          id: input.id,
          language: input.language,
          name: input.name,
        }),
  };
}

export function createUntitledMarkdownRecord(input: {
  contents: string;
  id: string;
  name: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument {
  return createUntitledRecord({
    ...input,
    language: "markdown",
  });
}

export function restoreUntitledMarkdownRecord(input: {
  id: string;
  name: string;
  persisted: PersistedUntitledDocument;
}): FilesDocument {
  const language = input.persisted.language ?? languageForPath(input.name);
  const eol = input.persisted.eol ?? "lf";
  const format = input.persisted.format ?? { bom: false, encoding: "utf8" };
  const savedEol = input.persisted.savedEol ?? eol;
  const savedFormat = input.persisted.savedFormat ?? format;
  const restored = {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    createdEmptyEol: null,
    currentContents: input.persisted.currentContents,
    deletedOnDisk: false,
    dirty: input.persisted.dirty,
    durabilityUnknown: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    eol,
    format,
    hasBackingStore: false,
    id: input.id,
    language,
    loadState: "loaded" as const,
    mode: null,
    mime: null,
    name: input.name,
    needsSaveAs: true,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle" as const,
    savedContents: input.persisted.savedContents,
    savedEol,
    savedFormat,
    size: null,
    source: input.persisted.origin
      ? createUntitledSource({
          id: input.id,
          language,
          name: input.name,
          origin: input.persisted.origin,
        })
      : createUntitledSource({
          id: input.id,
          language,
          name: input.name,
        }),
  };
  return {
    ...restored,
    dirty: computeDocumentDirty(restored) || input.persisted.dirty,
  };
}

export function createDiskDocumentRecord(input: {
  draft: PersistedDiskDraft | null;
  id: string;
  name?: string;
  path: string;
  root: string;
}): FilesDocument {
  if (input.draft) {
    const deletedOnDisk = input.draft.deletedOnDisk ?? false;
    const pathLanguage = languageForPath(input.path, input.root);
    return {
      baseMtimeMs: input.draft.baseMtimeMs,
      canonicalPath: input.draft.canonicalPath ?? null,
      capabilities: DISK_TEXT_CAPABILITIES,
      createdEmptyEol: null,
      currentContents: input.draft.currentContents,
      deletedOnDisk,
      dirty: input.draft.dirty ?? true,
      durabilityUnknown: input.draft.durabilityUnknown ?? false,
      conflictDiskContents: input.draft.conflictDiskContents ?? null,
      diskConflict: input.draft.diskConflict ?? false,
      error: null,
      eol: input.draft.eol ?? null,
      format: input.draft.format ?? null,
      hasBackingStore: !deletedOnDisk,
      id: input.id,
      language: input.draft.language ?? pathLanguage,
      languageOverridden:
        input.draft.language !== undefined &&
        input.draft.language !== pathLanguage,
      loadState: "idle",
      mode: input.draft.mode ?? null,
      mime: null,
      name: input.name ?? nameFromPath(input.path),
      needsSaveAs: false,
      preview: null,
      readOnly: false,
      readOnlyReason: null,
      revision: input.draft.revision ?? null,
      saveState: "idle",
      savedContents: input.draft.savedContents,
      savedEol: input.draft.savedEol ?? input.draft.eol ?? null,
      savedFormat: input.draft.savedFormat ?? input.draft.format ?? null,
      size: input.draft.size ?? null,
      source: { kind: "disk", path: input.path, root: input.root },
    };
  }
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: DISK_TEXT_CAPABILITIES,
    createdEmptyEol: null,
    currentContents: "",
    deletedOnDisk: false,
    dirty: false,
    durabilityUnknown: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    eol: null,
    format: null,
    hasBackingStore: true,
    id: input.id,
    language: languageForPath(input.path, input.root),
    loadState: "idle",
    mode: null,
    mime: null,
    name: input.name ?? nameFromPath(input.path),
    needsSaveAs: false,
    preview: null,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle",
    savedContents: "",
    savedEol: null,
    savedFormat: null,
    size: null,
    source: { kind: "disk", path: input.path, root: input.root },
  };
}

export function renameDiskDocumentRecord(
  document: FilesDocument,
  input: { id: string; path: string; root: string }
): FilesDocument {
  return {
    ...document,
    id: input.id,
    language: languageForPath(input.path, input.root),
    languageOverridden: false,
    name: nameFromPath(input.path),
    source: { kind: "disk", path: input.path, root: input.root },
  };
}
