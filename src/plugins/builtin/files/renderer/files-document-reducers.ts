import type { FilesDocument } from "./files-document-types.ts";

export function withDocumentContents(
  document: FilesDocument,
  contents: string
): FilesDocument {
  if (document.currentContents === contents) {
    return document;
  }
  return {
    ...document,
    currentContents: contents,
    dirty: true,
  };
}

export function withDocumentLoading(document: FilesDocument): FilesDocument {
  if (document.source.kind !== "disk" || document.loadState !== "idle") {
    return document;
  }
  return {
    ...document,
    error: null,
    loadState: "loading",
  };
}

export function withDocumentLoaded(
  document: FilesDocument,
  contents: string,
  baseMtimeMs: number | null
): FilesDocument {
  if (document.dirty) {
    return {
      ...document,
      error: null,
      loadState: "loaded",
    };
  }
  return {
    ...document,
    baseMtimeMs,
    currentContents: contents,
    dirty: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    loadState: "loaded",
    savedContents: contents,
  };
}

export function withDocumentSaved(
  document: FilesDocument,
  savedContents: string,
  baseMtimeMs: number | null | undefined
): FilesDocument {
  const dirty = document.currentContents !== savedContents;
  const nextBaseMtime =
    baseMtimeMs === undefined ? document.baseMtimeMs : baseMtimeMs;
  if (
    document.savedContents === savedContents &&
    document.dirty === dirty &&
    document.error === null &&
    document.baseMtimeMs === nextBaseMtime &&
    document.diskConflict === false
  ) {
    return document;
  }
  return {
    ...document,
    baseMtimeMs: nextBaseMtime,
    dirty,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    savedContents,
  };
}

export function withDocumentError(
  document: FilesDocument,
  message: string
): FilesDocument {
  return {
    ...document,
    error: message,
    loadState: "error",
  };
}

export function withDocumentSaveError(
  document: FilesDocument,
  message: string
): FilesDocument {
  return {
    ...document,
    dirty: true,
    error: message,
    loadState: document.loadState === "loading" ? "loading" : "loaded",
  };
}

export function withDocumentConflictContents(
  document: FilesDocument,
  contents: string | null
): FilesDocument {
  if (document.conflictDiskContents === contents) {
    return document;
  }
  return {
    ...document,
    conflictDiskContents: contents,
  };
}

export function withDocumentDiskConflict(
  document: FilesDocument
): FilesDocument {
  if (document.diskConflict) {
    return document;
  }
  return {
    ...document,
    diskConflict: true,
  };
}
