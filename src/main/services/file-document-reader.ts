import { constants, type Stats } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { extname } from "node:path";
import type {
  FileDocumentReadResult,
  FileInspectWriteTargetRequest,
  FileReadDocumentRequest,
  FileWriteTargetInspection,
} from "@shared/contracts/file.ts";
import { decodeFileDocument } from "./file-document-codec.ts";
import {
  isMissingPathError,
  resolveExistingFileIdentity,
  resolveWritableFileIdentity,
  revisionForFileBytes,
  unsupportedFileType,
  type WritableFileIdentity,
} from "./file-path-identity.ts";
import type { FileSafeWriter } from "./file-safe-writer.ts";

export const MAX_EDITABLE_FILE_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function mimeForPath(path: string): string | null {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

function permissionsMode(mode: number): number {
  return mode % 0o1_0000;
}

async function isSafelyWritable(target: string, info: Stats): Promise<boolean> {
  if (info.nlink > 1) {
    return false;
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    return false;
  }
  try {
    await access(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function inspectFileWriteTarget(
  request: FileInspectWriteTargetRequest,
  safeWriter: FileSafeWriter
): Promise<FileWriteTargetInspection> {
  let identity: WritableFileIdentity;
  try {
    identity = await resolveWritableFileIdentity(request.root, request.path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { kind: "absent" };
    }
    throw error;
  }
  if (!(identity.exists && identity.stat)) {
    return { kind: "absent" };
  }
  const unsupported = unsupportedFileType(identity.stat);
  if (unsupported) {
    return { fileType: unsupported, kind: "unsupported-file" };
  }
  if (!(await isSafelyWritable(identity.canonicalTarget, identity.stat))) {
    return {
      kind: "not-writable",
      message: "target metadata or permissions cannot be preserved safely",
    };
  }
  const revision = await safeWriter.inspectRevision(request);
  if (identity.stat.size > MAX_EDITABLE_FILE_BYTES) {
    return {
      fileType: "too-large",
      kind: "existing",
      revision: revision.revision,
      size: identity.stat.size,
    };
  }
  const bytes = await readFile(identity.canonicalTarget);
  if (bytes.length > MAX_EDITABLE_FILE_BYTES) {
    return {
      fileType: "too-large",
      kind: "existing",
      revision: revision.revision,
      size: bytes.length,
    };
  }
  return {
    fileType: decodeFileDocument(bytes).kind,
    kind: "existing",
    revision: revision.revision,
    size: identity.stat.size,
  };
}

export async function readFileDocument(
  request: FileReadDocumentRequest
): Promise<FileDocumentReadResult> {
  const identity = await resolveExistingFileIdentity(
    request.root,
    request.path
  );
  const unsupported = unsupportedFileType(identity.stat);
  if (unsupported) {
    return {
      fileType: unsupported,
      kind: "unsupported-file",
      path: request.path,
      root: request.root,
    };
  }
  if (identity.stat.size > MAX_EDITABLE_FILE_BYTES) {
    return {
      kind: "too-large",
      limit: MAX_EDITABLE_FILE_BYTES,
      path: request.path,
      root: request.root,
      size: identity.stat.size,
    };
  }
  const bytes = await readFile(identity.canonicalTarget);
  if (bytes.length > MAX_EDITABLE_FILE_BYTES) {
    return {
      kind: "too-large",
      limit: MAX_EDITABLE_FILE_BYTES,
      path: request.path,
      root: request.root,
      size: bytes.length,
    };
  }
  const decoded = decodeFileDocument(bytes);
  if (decoded.kind === "unsupported-encoding") {
    return {
      kind: "unsupported-encoding",
      path: request.path,
      root: request.root,
      size: bytes.length,
    };
  }
  const revision = revisionForFileBytes(identity, bytes);
  if (decoded.kind === "binary") {
    return {
      canonicalPath: identity.canonicalPath,
      kind: "binary",
      mime: mimeForPath(request.path),
      mtimeMs: identity.stat.mtimeMs,
      path: request.path,
      revision,
      root: request.root,
      size: bytes.length,
    };
  }
  return {
    canonicalPath: identity.canonicalPath,
    contents: decoded.contents,
    eol: decoded.eol,
    format: decoded.format,
    kind: "text",
    mode: permissionsMode(identity.stat.mode),
    path: request.path,
    revision,
    root: request.root,
    size: bytes.length,
    writable: await isSafelyWritable(identity.canonicalTarget, identity.stat),
  };
}
