import type {
  FileDocumentReadResult,
  FileDocumentWriteResult,
} from "@shared/contracts/file.ts";
import type { FilesDocument } from "./files-document-types.ts";

const DISK_SAVE_CAPABILITIES = ["save", "saveAs"] as const;

function unsupportedReadOnlyReason(
  result: Exclude<FileDocumentReadResult, { kind: "image" | "text" }>
): NonNullable<FilesDocument["readOnlyReason"]> {
  if (result.kind === "binary") {
    return "binary";
  }
  if (result.kind === "unsupported-encoding") {
    return "unknown-encoding";
  }
  return result.kind === "too-large" ? "too-large" : "unsupported-file";
}

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

export function withDocumentReadResult(
  document: FilesDocument,
  result: FileDocumentReadResult
): FilesDocument {
  if (result.kind === "image") {
    if (document.dirty || document.durabilityUnknown) {
      return {
        ...document,
        capabilities: [],
        diskConflict: true,
        error: null,
        loadState: "loaded",
        preview: null,
        readOnly: true,
        readOnlyReason: "binary",
        size: result.size,
      };
    }
    return {
      ...document,
      baseMtimeMs: result.mtimeMs,
      capabilities: [],
      canonicalPath: result.canonicalPath,
      currentContents: "",
      deletedOnDisk: false,
      dirty: false,
      eol: null,
      error: null,
      format: null,
      loadState: "loaded",
      mode: null,
      mime: result.mime,
      preview: {
        kind: "image",
        mime: result.mime,
        revision: result.revision,
      },
      readOnly: true,
      readOnlyReason: null,
      revision: result.revision,
      savedContents: "",
      size: result.size,
    };
  }
  if (result.kind !== "text") {
    const readOnlyReason = unsupportedReadOnlyReason(result);
    if (document.dirty || document.durabilityUnknown) {
      return {
        ...document,
        capabilities: [],
        diskConflict: true,
        error: null,
        loadState: "loaded",
        mime: result.kind === "binary" ? result.mime : null,
        preview: null,
        readOnly: true,
        readOnlyReason,
        size: "size" in result ? result.size : document.size,
      };
    }
    return {
      ...document,
      capabilities: [],
      canonicalPath: null,
      currentContents: "",
      dirty: false,
      eol: null,
      error: null,
      format: null,
      loadState: "loaded",
      mode: null,
      mime: result.kind === "binary" ? result.mime : null,
      preview: null,
      readOnly: true,
      readOnlyReason,
      revision: "revision" in result ? result.revision : null,
      savedContents: "",
      size: "size" in result ? result.size : null,
    };
  }
  let readOnlyReason: FilesDocument["readOnlyReason"] = null;
  if (!result.writable) {
    readOnlyReason = "not-writable";
  } else if (result.eol === "mixed") {
    readOnlyReason = "mixed-eol";
  }
  const protectedFromDiskReplacement =
    document.dirty || document.durabilityUnknown;
  if (protectedFromDiskReplacement && document.revision !== result.revision) {
    return {
      ...document,
      canonicalPath: result.canonicalPath,
      diskConflict: true,
      error: null,
      loadState: "loaded",
      mode: result.mode,
      size: result.size,
    };
  }
  const metadata = {
    capabilities: readOnlyReason ? [] : DISK_SAVE_CAPABILITIES,
    canonicalPath: result.canonicalPath,
    deletedOnDisk: false,
    eol: result.eol,
    error: null,
    format: result.format,
    hasBackingStore: true,
    loadState: "loaded" as const,
    mode: result.mode,
    mime: null,
    preview: null,
    readOnly: readOnlyReason !== null,
    readOnlyReason,
    revision: result.revision,
    size: result.size,
  };
  if (protectedFromDiskReplacement) {
    return { ...document, ...metadata };
  }
  return {
    ...document,
    ...metadata,
    currentContents: result.contents,
    dirty: false,
    savedContents: result.contents,
  };
}

export function withDocumentPathReconciled(
  document: FilesDocument,
  result: FileDocumentReadResult
): FilesDocument {
  if (result.kind !== "text") {
    return withDocumentReadResult(document, result);
  }
  const protectedContents = document.dirty || document.durabilityUnknown;
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
    capabilities: readOnlyReason ? [] : DISK_SAVE_CAPABILITIES,
    ...(protectedContents
      ? {}
      : {
          currentContents: result.contents,
          dirty: false,
          savedContents: result.contents,
        }),
    diskConflict,
    eol: result.eol,
    error: null,
    format: result.format,
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
    return document;
  }
  return {
    ...document,
    capabilities: DISK_SAVE_CAPABILITIES,
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
  if (document.diskConflict) {
    return document;
  }
  return {
    ...document,
    diskConflict: true,
  };
}

export function withDocumentDeletedOnDisk(
  document: FilesDocument
): FilesDocument {
  return {
    ...document,
    deletedOnDisk: true,
    dirty: true,
    diskConflict: true,
    error: null,
    hasBackingStore: false,
    loadState: "loaded",
    saveState: "idle",
  };
}
