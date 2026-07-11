import type {
  PersistedDiskDraft,
  PersistedUntitledDocument,
} from "./files-document-drafts.ts";
import type {
  FilesDocument,
  FilesDocumentCapability,
  FilesDocumentOrigin,
  FilesDocumentSource,
} from "./files-document-types.ts";
import { languageForPath } from "./files-language-detection.ts";

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

export function createUntitledMarkdownRecord(input: {
  contents: string;
  id: string;
  name: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument {
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: input.contents,
    deletedOnDisk: false,
    dirty: false,
    durabilityUnknown: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    hasBackingStore: false,
    id: input.id,
    language: "markdown",
    loadState: "loaded",
    mode: null,
    name: input.name,
    needsSaveAs: true,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle",
    savedContents: input.contents,
    size: null,
    source: input.origin
      ? createUntitledSource({
          id: input.id,
          name: input.name,
          origin: input.origin,
        })
      : createUntitledSource({ id: input.id, name: input.name }),
  };
}

export function restoreUntitledMarkdownRecord(input: {
  id: string;
  name: string;
  persisted: PersistedUntitledDocument;
}): FilesDocument {
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: input.persisted.currentContents,
    deletedOnDisk: false,
    dirty: input.persisted.dirty,
    durabilityUnknown: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    hasBackingStore: false,
    id: input.id,
    language: "markdown",
    loadState: "loaded",
    mode: null,
    name: input.name,
    needsSaveAs: true,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle",
    savedContents: input.persisted.savedContents,
    size: null,
    source: input.persisted.origin
      ? createUntitledSource({
          id: input.id,
          name: input.name,
          origin: input.persisted.origin,
        })
      : createUntitledSource({ id: input.id, name: input.name }),
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
    return {
      baseMtimeMs: input.draft.baseMtimeMs,
      canonicalPath: input.draft.canonicalPath ?? null,
      capabilities: DISK_TEXT_CAPABILITIES,
      currentContents: input.draft.currentContents,
      deletedOnDisk: false,
      dirty: input.draft.dirty ?? true,
      durabilityUnknown: input.draft.durabilityUnknown ?? false,
      conflictDiskContents: null,
      diskConflict: false,
      error: null,
      eol: input.draft.eol ?? null,
      format: input.draft.format ?? null,
      hasBackingStore: true,
      id: input.id,
      language: languageForPath(input.path),
      loadState: "idle",
      mode: input.draft.mode ?? null,
      name: input.name ?? nameFromPath(input.path),
      needsSaveAs: false,
      readOnly: false,
      readOnlyReason: null,
      revision: input.draft.revision ?? null,
      saveState: "idle",
      savedContents: input.draft.savedContents,
      size: input.draft.size ?? null,
      source: { kind: "disk", path: input.path, root: input.root },
    };
  }
  return {
    baseMtimeMs: null,
    canonicalPath: null,
    capabilities: DISK_TEXT_CAPABILITIES,
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
    language: languageForPath(input.path),
    loadState: "idle",
    mode: null,
    name: input.name ?? nameFromPath(input.path),
    needsSaveAs: false,
    readOnly: false,
    readOnlyReason: null,
    revision: null,
    saveState: "idle",
    savedContents: "",
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
    language: languageForPath(input.path),
    name: nameFromPath(input.path),
    source: { kind: "disk", path: input.path, root: input.root },
  };
}
