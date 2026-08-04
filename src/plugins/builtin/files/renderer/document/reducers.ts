import type {
  FileDocumentReadResult,
  FileDocumentWriteResult,
} from "@shared/contracts/file.ts";
import {
  computeDocumentDirty,
  protectsLocalBufferFromDisk,
} from "./disk-protection.ts";
import {
  createdEmptyEolAfterRead,
  DISK_SAVE_CAPABILITIES,
  withDocumentReadResult,
} from "./read-result.ts";
import type { FilesDocument } from "./types.ts";

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
          savedContents: result.contents,
        }),
    ...(protectedContents ? { diskConflict } : {}),
    deletedOnDisk: false,
    eol: createdEmptyEol ?? result.eol,
    error: null,
    format: result.format,
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
    createdEmptyEol: null,
    dirty,
    deletedOnDisk: false,
    conflictDiskContents: null,
    diskConflict: false,
    error: null,
    saveState: "idle",
    savedContents,
  };
}

export function withDocumentWritten(
  document: FilesDocument,
  savedContents: string,
  result: Extract<FileDocumentWriteResult, { kind: "written" }>
): FilesDocument {
  const dirty = document.currentContents !== savedContents;
  return {
    ...document,
    baseMtimeMs: result.mtimeMs,
    createdEmptyEol: null,
    conflictDiskContents: null,
    dirty,
    deletedOnDisk: false,
    diskConflict: false,
    durabilityUnknown: result.durability === "unknown",
    error: null,
    hasBackingStore: true,
    mode: result.mode,
    revision: result.revision,
    saveState: "idle",
    savedContents,
    size: result.size,
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

export function withDocumentNormalizedEol(
  document: FilesDocument,
  eol: "crlf" | "lf"
): FilesDocument {
  if (document.readOnlyReason !== "mixed-eol") {
    return document.createdEmptyEol === null
      ? document
      : { ...document, createdEmptyEol: null };
  }
  return {
    ...document,
    capabilities: DISK_SAVE_CAPABILITIES,
    createdEmptyEol: null,
    dirty: true,
    eol,
    readOnly: false,
    readOnlyReason: null,
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
