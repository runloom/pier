import { z } from "zod";

/** Hard ceiling for one file handed to a preview renderer. */
export const MAX_FILE_PREVIEW_BYTES = 64 * 1024 * 1024;

/** PDF / OOXML previews share the generic preview ceiling. */
export const MAX_DOCUMENT_PREVIEW_FILE_BYTES = MAX_FILE_PREVIEW_BYTES;

export const filePreviewDocumentMimeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export type FilePreviewDocumentMime = z.infer<
  typeof filePreviewDocumentMimeSchema
>;

export const fileDocumentPreviewFormatSchema = z.enum(["pdf", "docx", "xlsx"]);
export type FileDocumentPreviewFormat = z.infer<
  typeof fileDocumentPreviewFormatSchema
>;

export const fileDocumentUnsupportedFormatSchema = z.enum([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
]);
export type FileDocumentUnsupportedFormat = z.infer<
  typeof fileDocumentUnsupportedFormatSchema
>;

export const fileDocumentUnsupportedReasonSchema = z.enum([
  "encrypted",
  "legacy",
  "not-supported",
  "too-large",
]);
export type FileDocumentUnsupportedReason = z.infer<
  typeof fileDocumentUnsupportedReasonSchema
>;

export const FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT: Readonly<
  Record<FileDocumentPreviewFormat, FilePreviewDocumentMime>
> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const FILE_PREVIEW_MIME_BY_UNSUPPORTED_FORMAT: Readonly<
  Record<FileDocumentUnsupportedFormat, string>
> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type DocumentPreviewClassification =
  | {
      kind: "document";
      format: FileDocumentPreviewFormat;
      mime: FilePreviewDocumentMime;
    }
  | {
      kind: "unsupported";
      format: FileDocumentUnsupportedFormat;
      reason: FileDocumentUnsupportedReason;
      mime: string;
    }
  | { kind: "none" };
