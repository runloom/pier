import { extname } from "node:path";
import {
  type DocumentPreviewClassification,
  FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT,
  FILE_PREVIEW_MIME_BY_UNSUPPORTED_FORMAT,
  type FileDocumentUnsupportedFormat,
} from "@shared/contracts/file/document.ts";

const PDF_HEADER = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const ZIP_HEADER = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const CFB_HEADER = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

const OOXML_FORMATS = new Set<FileDocumentUnsupportedFormat>([
  "docx",
  "xlsx",
  "pptx",
]);
const LEGACY_FORMATS = new Set<FileDocumentUnsupportedFormat>([
  "doc",
  "xls",
  "ppt",
]);

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return false;
    }
  }
  return true;
}

function containsPdfHeader(bytes: Uint8Array): boolean {
  const last = Math.min(bytes.length, 1024) - PDF_HEADER.length;
  for (let index = 0; index <= last; index += 1) {
    if (bytes[index] !== PDF_HEADER[0]) {
      continue;
    }
    let matched = true;
    for (let offset = 1; offset < PDF_HEADER.length; offset += 1) {
      if (bytes[index + offset] !== PDF_HEADER[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

function unsupported(
  format: FileDocumentUnsupportedFormat,
  reason: "encrypted" | "legacy" | "not-supported"
): DocumentPreviewClassification {
  return {
    kind: "unsupported",
    format,
    reason,
    mime: FILE_PREVIEW_MIME_BY_UNSUPPORTED_FORMAT[format],
  };
}

/**
 * Classify a document preview from its extension and first KiB of bytes.
 *
 * Extension + magic must agree; unknown or spoofed combinations fall back to
 * the normal text/binary pipeline. CFB containers carry both encrypted OOXML
 * and legacy Office files, so the extension decides which message to show.
 */
export function classifyDocumentPreview(input: {
  path: string;
  header: Uint8Array;
}): DocumentPreviewClassification {
  const extension = extname(input.path).toLowerCase().slice(1);
  if (
    extension !== "pdf" &&
    !OOXML_FORMATS.has(extension as FileDocumentUnsupportedFormat) &&
    !LEGACY_FORMATS.has(extension as FileDocumentUnsupportedFormat)
  ) {
    return { kind: "none" };
  }

  const format = extension as FileDocumentUnsupportedFormat;
  const isZip = startsWith(input.header, ZIP_HEADER);
  const isCfb = startsWith(input.header, CFB_HEADER);

  if (extension === "pdf") {
    if (!containsPdfHeader(input.header)) {
      return { kind: "none" };
    }
    return {
      kind: "document",
      format: "pdf",
      mime: FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT.pdf,
    };
  }

  if (isCfb) {
    return OOXML_FORMATS.has(format)
      ? unsupported(format, "encrypted")
      : unsupported(format, "legacy");
  }
  if (!isZip) {
    return { kind: "none" };
  }
  if (format === "pptx") {
    return unsupported(format, "not-supported");
  }
  if (format === "docx" || format === "xlsx") {
    return {
      kind: "document",
      format,
      mime: FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT[format],
    };
  }
  return { kind: "none" };
}
