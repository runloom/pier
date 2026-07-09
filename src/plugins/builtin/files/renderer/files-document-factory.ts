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
] satisfies readonly FilesDocumentCapability[];
const TEMPORARY_MARKDOWN_CAPABILITIES =
  [] satisfies readonly FilesDocumentCapability[];

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
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: input.contents,
    dirty: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    id: input.id,
    language: "markdown",
    loadState: "loaded",
    name: input.name,
    readOnly: false,
    saveState: "idle",
    savedContents: input.contents,
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
    capabilities: TEMPORARY_MARKDOWN_CAPABILITIES,
    currentContents: input.persisted.currentContents,
    dirty: input.persisted.dirty,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    id: input.id,
    language: "markdown",
    loadState: "loaded",
    name: input.name,
    readOnly: false,
    saveState: "idle",
    savedContents: input.persisted.savedContents,
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
      capabilities: DISK_TEXT_CAPABILITIES,
      currentContents: input.draft.currentContents,
      dirty: true,
      conflictDiskContents: null,
      diskConflict: false,
      error: null,
      id: input.id,
      language: languageForPath(input.path),
      loadState: "loaded",
      name: input.name ?? nameFromPath(input.path),
      readOnly: false,
      saveState: "idle",
      savedContents: input.draft.savedContents,
      source: { kind: "disk", path: input.path, root: input.root },
    };
  }
  return {
    baseMtimeMs: null,
    capabilities: DISK_TEXT_CAPABILITIES,
    currentContents: "",
    dirty: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    id: input.id,
    language: languageForPath(input.path),
    loadState: "idle",
    name: input.name ?? nameFromPath(input.path),
    readOnly: false,
    saveState: "idle",
    savedContents: "",
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
