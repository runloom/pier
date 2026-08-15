import type {
  FileDocumentFormat,
  FileDocumentReadResult,
  FileDocumentWriteResult,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import { languageForPath } from "../editor/language-detection.ts";
import {
  computeDocumentDirty,
  documentSaveFormatDirty,
  protectsLocalBufferFromDisk,
} from "./disk-protection.ts";
import {
  createdEmptyEolAfterRead,
  DISK_SAVE_CAPABILITIES,
  withDocumentReadResult,
} from "./read-result.ts";
import type { FilesDocument, FilesDocumentLanguage } from "./types.ts";

export { withDocumentReadResult } from "./read-result.ts";

export function withDocumentContents(
  document: FilesDocument,
  contents: string
): FilesDocument {
  const next = {
    ...document,
    currentContents: contents,
  };
  const dirty = computeDocumentDirty(next);
  let nextDiskConflict = document.diskConflict;
  let nextConflictDiskContents = document.conflictDiskContents;
  if (!dirty) {
    // Clean buffer: keep conflict only when a divergent disk snapshot remains.
    if (
      document.conflictDiskContents !== null &&
      document.conflictDiskContents !== contents
    ) {
      nextDiskConflict = true;
    } else {
      nextDiskConflict = false;
      nextConflictDiskContents = null;
    }
  }
  if (
    document.currentContents === contents &&
    document.dirty === dirty &&
    document.diskConflict === nextDiskConflict &&
    document.conflictDiskContents === nextConflictDiskContents
  ) {
    return document;
  }
  return {
    ...document,
    currentContents: contents,
    createdEmptyEol:
      document.currentContents === contents ? document.createdEmptyEol : null,
    conflictDiskContents: nextConflictDiskContents,
    dirty,
    diskConflict: nextDiskConflict,
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
      createdEmptyEol: null,
      error: null,
      loadState: "loaded",
    };
  }
  return {
    ...document,
    baseMtimeMs,
    createdEmptyEol: null,
    currentContents: contents,
    dirty: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    loadState: "loaded",
    savedContents: contents,
  };
}

export function withDocumentPathReconciled(
  document: FilesDocument,
  result: FileDocumentReadResult
): FilesDocument {
  if (result.kind !== "text") {
    return withDocumentReadResult(document, result);
  }
  const createdEmptyEol = createdEmptyEolAfterRead(document, result);
  const protectedContents = protectsLocalBufferFromDisk(document);
  const diskConflict =
    protectedContents && document.savedContents !== result.contents;
  let readOnlyReason: FilesDocument["readOnlyReason"] = null;
  if (!result.writable) {
    readOnlyReason = "not-writable";
  } else if (result.eol === "mixed") {
    readOnlyReason = "mixed-eol";
  }
  const adoptedEol = createdEmptyEol ?? result.eol;
  return {
    ...document,
    canonicalPath: result.canonicalPath,
    createdEmptyEol,
    capabilities: readOnlyReason ? [] : DISK_SAVE_CAPABILITIES,
    ...(protectedContents
      ? {}
      : {
          conflictDiskContents: null,
          currentContents: result.contents,
          dirty: false,
          diskConflict: false,
          eol: adoptedEol,
          format: result.format,
          savedContents: result.contents,
          savedEol: adoptedEol,
          savedFormat: result.format,
        }),
    ...(protectedContents ? { diskConflict } : {}),
    deletedOnDisk: false,
    error: null,
    hasBackingStore: true,
    loadState: "loaded",
    mode: result.mode,
    mime: null,
    preview: null,
    readOnly: readOnlyReason !== null,
    readOnlyReason,
    revision: result.revision,
    size: result.size,
  };
}

export function withDocumentSaved(
  document: FilesDocument,
  savedContents: string,
  baseMtimeMs: number | null | undefined
): FilesDocument {
  const nextBaseMtime =
    baseMtimeMs === undefined ? document.baseMtimeMs : baseMtimeMs;
  const next = {
    ...document,
    baseMtimeMs: nextBaseMtime,
    createdEmptyEol: null,
    deletedOnDisk: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    saveState: "idle" as const,
    savedContents,
    savedEol: document.eol,
    savedFormat: document.format,
  };
  const dirty =
    next.currentContents !== next.savedContents ||
    documentSaveFormatDirty(next);
  if (
    document.savedContents === savedContents &&
    document.savedEol === next.savedEol &&
    document.savedFormat === next.savedFormat &&
    document.dirty === dirty &&
    document.error === null &&
    document.baseMtimeMs === nextBaseMtime &&
    document.diskConflict === false
  ) {
    return document;
  }
  return {
    ...next,
    dirty,
  };
}

export function withDocumentWritten(
  document: FilesDocument,
  savedContents: string,
  result: Extract<FileDocumentWriteResult, { kind: "written" }>
): FilesDocument {
  const next = {
    ...document,
    baseMtimeMs: result.mtimeMs,
    createdEmptyEol: null,
    conflictDiskContents: null,
    deletedOnDisk: false,
    diskConflict: false,
    durabilityUnknown: result.durability === "unknown",
    error: null,
    hasBackingStore: true,
    mode: result.mode,
    revision: result.revision,
    saveState: "idle" as const,
    savedContents,
    savedEol: document.eol,
    savedFormat: document.format,
    size: result.size,
  };
  return {
    ...next,
    dirty:
      next.currentContents !== next.savedContents ||
      documentSaveFormatDirty(next),
  };
}

export function withDocumentDurabilityConfirmed(
  document: FilesDocument,
  revision: string
): FilesDocument {
  return {
    ...document,
    durabilityUnknown: false,
    error: null,
    revision,
  };
}

export function withDocumentDurabilityError(
  document: FilesDocument,
  message: string
): FilesDocument {
  return {
    ...document,
    error: message,
  };
}

export function withDocumentLanguage(
  document: FilesDocument,
  language: FilesDocumentLanguage
): FilesDocument {
  const nextSource =
    document.source.kind === "untitled"
      ? { ...document.source, language }
      : document.source;
  const languageOverridden =
    document.source.kind === "disk" &&
    language !== languageForPath(document.source.path, document.source.root);
  if (
    document.language === language &&
    document.source === nextSource &&
    document.languageOverridden === languageOverridden
  ) {
    return document;
  }
  return {
    ...document,
    language,
    languageOverridden,
    source: nextSource,
  };
}

export function withDocumentSaveEol(
  document: FilesDocument,
  eol: FileWritableDocumentEol
): FilesDocument {
  if (document.readOnlyReason === "mixed-eol") {
    return withDocumentNormalizedEol(document, eol === "cr" ? "lf" : eol);
  }
  if (document.eol === eol) {
    return document;
  }
  const next = {
    ...document,
    createdEmptyEol: null,
    eol,
  };
  return {
    ...next,
    dirty: computeDocumentDirty(next),
  };
}

export function withDocumentSaveFormat(
  document: FilesDocument,
  format: FileDocumentFormat
): FilesDocument {
  const current = document.format;
  if (
    current &&
    current.encoding === format.encoding &&
    current.bom === format.bom
  ) {
    return document;
  }
  const next = {
    ...document,
    format,
  };
  return {
    ...next,
    dirty: computeDocumentDirty(next),
  };
}

export function withDocumentNormalizedEol(
  document: FilesDocument,
  eol: "crlf" | "lf"
): FilesDocument {
  if (document.readOnlyReason !== "mixed-eol") {
    return document.createdEmptyEol === null
      ? document
      : { ...document, createdEmptyEol: null };
  }
  const next = {
    ...document,
    capabilities: DISK_SAVE_CAPABILITIES,
    createdEmptyEol: null,
    eol,
    readOnly: false,
    readOnlyReason: null,
  };
  return {
    ...next,
    dirty: computeDocumentDirty(next),
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
    saveState: "idle",
  };
}

export function withDocumentSaving(document: FilesDocument): FilesDocument {
  return document.saveState === "saving"
    ? document
    : { ...document, error: null, saveState: "saving" };
}

export function withDocumentSaveIdle(document: FilesDocument): FilesDocument {
  return document.saveState === "idle"
    ? document
    : { ...document, saveState: "idle" };
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
  // File is present again (reload / durability mismatch). Clear deletion-only
  // flags while preserving the local buffer under conflict.
  if (
    document.diskConflict &&
    document.createdEmptyEol === null &&
    !document.deletedOnDisk &&
    document.hasBackingStore
  ) {
    return document;
  }
  return {
    ...document,
    createdEmptyEol: null,
    deletedOnDisk: false,
    diskConflict: true,
    hasBackingStore: true,
  };
}

/** Keep local buffer; clear conflict chrome after the user dismisses the banner. */
export function withDocumentDiskConflictDismissed(
  document: FilesDocument
): FilesDocument {
  if (!(document.diskConflict || document.conflictDiskContents !== null)) {
    return document;
  }
  return {
    ...document,
    conflictDiskContents: null,
    diskConflict: false,
  };
}

export function withDocumentDeletedOnDisk(
  document: FilesDocument
): FilesDocument {
  return {
    ...document,
    // Keep the in-memory buffer; clear revision so Save recreates with
    // expected: absent instead of treating deletion as a revision conflict.
    conflictDiskContents: null,
    createdEmptyEol: null,
    deletedOnDisk: true,
    dirty: true,
    diskConflict: true,
    error: null,
    hasBackingStore: false,
    loadState: "loaded",
    revision: null,
    saveState: "idle",
  };
}
