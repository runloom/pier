import type { FileDocumentReadResult } from "@shared/contracts/file.ts";
import { protectsLocalBufferFromDisk } from "./disk-protection.ts";
import type { FilesDocument } from "./types.ts";

export const DISK_SAVE_CAPABILITIES = ["save", "saveAs"] as const;

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
export function createdEmptyEolAfterRead(
  document: FilesDocument,
  result: FileDocumentReadResult
): FilesDocument["createdEmptyEol"] {
  return document.createdEmptyEol !== null &&
    result.kind === "text" &&
    document.currentContents === "" &&
    document.savedContents === "" &&
    result.contents === "" &&
    result.revision === document.revision
    ? document.createdEmptyEol
    : null;
}

export function withDocumentReadResult(
  document: FilesDocument,
  result: FileDocumentReadResult
): FilesDocument {
  const createdEmptyEol = createdEmptyEolAfterRead(document, result);
  if (result.kind === "image") {
    if (protectsLocalBufferFromDisk(document)) {
      return {
        ...document,
        capabilities: [],
        createdEmptyEol,
        deletedOnDisk: false,
        diskConflict: true,
        error: null,
        hasBackingStore: true,
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
      conflictDiskContents: null,
      currentContents: "",
      createdEmptyEol,
      deletedOnDisk: false,
      dirty: false,
      diskConflict: false,
      eol: null,
      error: null,
      format: null,
      hasBackingStore: true,
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
    if (protectsLocalBufferFromDisk(document)) {
      return {
        ...document,
        capabilities: [],
        createdEmptyEol,
        deletedOnDisk: false,
        diskConflict: true,
        error: null,
        hasBackingStore: true,
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
      conflictDiskContents: null,
      createdEmptyEol,
      currentContents: "",
      deletedOnDisk: false,
      dirty: false,
      diskConflict: false,
      eol: null,
      error: null,
      format: null,
      hasBackingStore: true,
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
  const protectedFromDiskReplacement = protectsLocalBufferFromDisk(document);
  if (protectedFromDiskReplacement && document.revision !== result.revision) {
    return {
      ...document,
      canonicalPath: result.canonicalPath,
      createdEmptyEol,
      deletedOnDisk: false,
      diskConflict: true,
      error: null,
      hasBackingStore: true,
      loadState: "loaded",
      mode: result.mode,
      size: result.size,
    };
  }
  const metadata = {
    baseMtimeMs: result.mtimeMs,
    capabilities: readOnlyReason ? [] : DISK_SAVE_CAPABILITIES,
    createdEmptyEol,
    canonicalPath: result.canonicalPath,
    deletedOnDisk: false,
    eol: createdEmptyEol ?? result.eol,
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
    conflictDiskContents: null,
    currentContents: result.contents,
    dirty: false,
    diskConflict: false,
    savedContents: result.contents,
  };
}
