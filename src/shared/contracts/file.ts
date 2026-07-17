import { z } from "zod";

const driveAbsolutePathPattern = /^[A-Za-z]:[\\/]/;
const pathSegmentSeparatorPattern = /[\\/]+/;

function isRootRelativePath(path: string): boolean {
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    driveAbsolutePathPattern.test(path)
  ) {
    return false;
  }

  return path
    .split(pathSegmentSeparatorPattern)
    .every((segment) => segment !== "..");
}

export const fileRootSchema = z.string().min(1);

export const fileRootRelativePathSchema = z
  .string()
  .refine(isRootRelativePath, "Expected a root-relative path");

export const nonEmptyFileRootRelativePathSchema = z
  .string()
  .min(1)
  .refine(isRootRelativePath, "Expected a root-relative path");

export const fileListRequestSchema = z.object({
  path: fileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileListRequest = z.infer<typeof fileListRequestSchema>;

// v1 兼容契约；新代码使用 fileReadDocumentRequestSchema。
export const fileReadTextRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
});
// v1 兼容类型；新代码使用 FileReadDocumentRequest。
export type FileReadTextRequest = z.infer<typeof fileReadTextRequestSchema>;

export const fileReadDocumentRequestSchema = fileReadTextRequestSchema;
export type FileReadDocumentRequest = z.infer<
  typeof fileReadDocumentRequestSchema
>;

export const fileDocumentFormatSchema = z.union([
  z.object({
    bom: z.boolean(),
    encoding: z.literal("utf8"),
  }),
  z.object({
    bom: z.literal(true),
    encoding: z.enum(["utf16le", "utf16be"]),
  }),
]);
export type FileDocumentFormat = z.infer<typeof fileDocumentFormatSchema>;

export const fileDocumentEolSchema = z.enum([
  "lf",
  "crlf",
  "cr",
  "mixed",
  "none",
]);
export type FileDocumentEol = z.infer<typeof fileDocumentEolSchema>;

export const fileWritableDocumentEolSchema = z.enum(["lf", "crlf", "cr"]);
export type FileWritableDocumentEol = z.infer<
  typeof fileWritableDocumentEolSchema
>;

export const fileDocumentExpectedStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({
    kind: z.literal("revision"),
    revision: z.string().min(1),
  }),
]);
export type FileDocumentExpectedState = z.infer<
  typeof fileDocumentExpectedStateSchema
>;

export const fileWriteDocumentRequestSchema = fileReadTextRequestSchema.extend({
  contents: z.string(),
  eol: fileWritableDocumentEolSchema,
  expected: fileDocumentExpectedStateSchema,
  format: fileDocumentFormatSchema,
  operationId: z.string().uuid().optional(),
});
export type FileWriteDocumentRequest = z.infer<
  typeof fileWriteDocumentRequestSchema
>;

export const FILE_WRITE_COMMIT_RECEIPT_STORAGE_PREFIX =
  "pier.files.writeCommitReceipt:";

export function fileWriteCommitReceiptStorageKey(operationId: string): string {
  return `${FILE_WRITE_COMMIT_RECEIPT_STORAGE_PREFIX}${operationId}`;
}

export const fileInspectWriteTargetRequestSchema = fileReadTextRequestSchema;
export type FileInspectWriteTargetRequest = z.infer<
  typeof fileInspectWriteTargetRequestSchema
>;

export const fileInspectPathImpactRequestSchema = fileReadTextRequestSchema;
export type FileInspectPathImpactRequest = z.infer<
  typeof fileInspectPathImpactRequestSchema
>;

export const fileConfirmDurabilityRequestSchema =
  fileReadTextRequestSchema.extend({
    expectedRevision: z.string().min(1),
  });
export type FileConfirmDurabilityRequest = z.infer<
  typeof fileConfirmDurabilityRequestSchema
>;

// v1 兼容契约；新代码使用 fileWriteDocumentRequestSchema。
export const fileWriteTextRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
  contents: z.string(),
  expectedMtimeMs: z.number().nonnegative().optional(),
});
// v1 兼容类型；新代码使用 FileWriteDocumentRequest。
export type FileWriteTextRequest = z.infer<typeof fileWriteTextRequestSchema>;

export const fileStatRequestSchema = fileReadTextRequestSchema;
export type FileStatRequest = z.infer<typeof fileStatRequestSchema>;

export const fileMoveRequestSchema = fileReadTextRequestSchema.extend({
  newPath: nonEmptyFileRootRelativePathSchema,
});
export type FileMoveRequest = z.infer<typeof fileMoveRequestSchema>;

export const fileCopyRequestSchema = fileReadTextRequestSchema.extend({
  newPath: nonEmptyFileRootRelativePathSchema,
});
export type FileCopyRequest = z.infer<typeof fileCopyRequestSchema>;

export const fileRevealRequestSchema = fileReadTextRequestSchema;
export type FileRevealRequest = z.infer<typeof fileRevealRequestSchema>;

export const fileOpenPathRequestSchema = z.object({
  path: z.string().min(1).max(16_384),
});
export type FileOpenPathRequest = z.infer<typeof fileOpenPathRequestSchema>;

export const fileOpenPathResultSchema = z.discriminatedUnion("opened", [
  z.object({ opened: z.literal(true) }),
  z.object({
    opened: z.literal(false),
    reason: z.enum(["invalid-path", "open-failed"]),
  }),
]);
export type FileOpenPathResult = z.infer<typeof fileOpenPathResultSchema>;

export const fileDraftsSetRequestSchema = z.object({
  generation: z.number().int().nonnegative(),
  key: z.string().min(1),
  value: z.string(),
});
export type FileDraftsSetRequest = z.infer<typeof fileDraftsSetRequestSchema>;

export const fileDraftsDeleteRequestSchema = z.object({
  key: z.string().min(1),
});
export type FileDraftsDeleteRequest = z.infer<
  typeof fileDraftsDeleteRequestSchema
>;

export const fileDraftsGetRequestSchema = fileDraftsDeleteRequestSchema;
export type FileDraftsGetRequest = z.infer<typeof fileDraftsGetRequestSchema>;

export const fileDraftsClaimLegacyRequestSchema = fileDraftsDeleteRequestSchema;
export type FileDraftsClaimLegacyRequest = z.infer<
  typeof fileDraftsClaimLegacyRequestSchema
>;

export const fileDraftSnapshotSchema = z.object({
  bytes: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  key: z.string().min(1),
  updatedAt: z.number().nonnegative(),
  value: z.string(),
});
export type FileDraftSnapshot = z.infer<typeof fileDraftSnapshotSchema>;

export const fileDraftDiagnosticSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1),
  quarantinedAt: z.number().nonnegative(),
});
export type FileDraftDiagnostic = z.infer<typeof fileDraftDiagnosticSchema>;

export const fileDraftWriteResultSchema = z.discriminatedUnion("kind", [
  fileDraftSnapshotSchema.omit({ value: true }).extend({
    kind: z.literal("stored"),
  }),
  z.object({
    kind: z.literal("rejected"),
    reason: z.enum(["entry-too-large", "quota-exceeded", "stale-generation"]),
  }),
  z.object({ kind: z.literal("failed"), message: z.string().min(1) }),
]);
export type FileDraftWriteResult = z.infer<typeof fileDraftWriteResultSchema>;

export const fileDraftClaimResultSchema = z.discriminatedUnion("kind", [
  z.object({ draft: fileDraftSnapshotSchema, kind: z.literal("claimed") }),
  z.object({
    draft: fileDraftSnapshotSchema,
    kind: z.literal("already-claimed"),
  }),
  z.object({ draft: fileDraftSnapshotSchema, kind: z.literal("conflict") }),
  z.object({ kind: z.literal("not-found") }),
]);
export type FileDraftClaimResult = z.infer<typeof fileDraftClaimResultSchema>;

export const fileTrashRequestSchema = fileReadTextRequestSchema;
export type FileTrashRequest = z.infer<typeof fileTrashRequestSchema>;

export const fileMkdirRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileMkdirRequest = z.infer<typeof fileMkdirRequestSchema>;

export const fileExistsRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileExistsRequest = z.infer<typeof fileExistsRequestSchema>;

export const fileEntrySchema = z.object({
  kind: z.enum(["directory", "file"]),
  path: fileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const fileListResultSchema = z.array(fileEntrySchema);
export type FileListResult = z.infer<typeof fileListResultSchema>;

export const fileUnsupportedTypeSchema = z.enum([
  "directory",
  "fifo",
  "socket",
  "device",
]);
export type FileUnsupportedType = z.infer<typeof fileUnsupportedTypeSchema>;

export const filePreviewImageMimeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export type FilePreviewImageMime = z.infer<typeof filePreviewImageMimeSchema>;

const fileDocumentLocatorResultSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
});

export const fileDocumentReadResultSchema = z.discriminatedUnion("kind", [
  fileDocumentLocatorResultSchema.extend({
    canonicalPath: nonEmptyFileRootRelativePathSchema,
    contents: z.string(),
    eol: fileDocumentEolSchema,
    format: fileDocumentFormatSchema,
    kind: z.literal("text"),
    mode: z.number().int().nonnegative().nullable(),
    revision: z.string().min(1),
    size: z.number().int().nonnegative(),
    writable: z.boolean(),
  }),
  fileDocumentLocatorResultSchema.extend({
    canonicalPath: nonEmptyFileRootRelativePathSchema,
    kind: z.literal("binary"),
    mime: z.string().min(1).nullable(),
    mtimeMs: z.number().nonnegative(),
    revision: z.string().min(1),
    size: z.number().int().nonnegative(),
  }),
  fileDocumentLocatorResultSchema
    .extend({
      canonicalPath: nonEmptyFileRootRelativePathSchema,
      kind: z.literal("image"),
      mime: filePreviewImageMimeSchema,
      mtimeMs: z.number().nonnegative(),
      revision: z.string().min(1),
      size: z.number().int().nonnegative(),
    })
    .strict(),
  fileDocumentLocatorResultSchema.extend({
    kind: z.literal("unsupported-encoding"),
    size: z.number().int().nonnegative(),
  }),
  fileDocumentLocatorResultSchema.extend({
    fileType: fileUnsupportedTypeSchema,
    kind: z.literal("unsupported-file"),
  }),
  fileDocumentLocatorResultSchema.extend({
    kind: z.literal("too-large"),
    limit: z.number().int().positive(),
    size: z.number().int().nonnegative(),
  }),
]);
export type FileDocumentReadResult = z.infer<
  typeof fileDocumentReadResultSchema
>;

export const fileDocumentWriteResultSchema = z.discriminatedUnion("kind", [
  z.object({
    canonicalPath: nonEmptyFileRootRelativePathSchema,
    committed: z.literal(true),
    durability: z.enum(["confirmed", "unknown"]),
    kind: z.literal("written"),
    mode: z.number().int().nonnegative().nullable(),
    mtimeMs: z.number().nonnegative(),
    revision: z.string().min(1),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("conflict"),
    reason: z.enum(["revision-mismatch", "target-exists", "target-missing"]),
  }),
  z.object({
    kind: z.literal("not-writable"),
    message: z.string().min(1),
  }),
]);
export type FileDocumentWriteResult = z.infer<
  typeof fileDocumentWriteResultSchema
>;

export const fileWriteTargetInspectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({
    fileType: z.enum(["text", "binary", "unsupported-encoding", "too-large"]),
    kind: z.literal("existing"),
    revision: z.string().min(1),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("not-writable"),
    message: z.string().min(1),
  }),
  z.object({
    fileType: fileUnsupportedTypeSchema,
    kind: z.literal("unsupported-file"),
  }),
]);
export type FileWriteTargetInspection = z.infer<
  typeof fileWriteTargetInspectionSchema
>;

export const filePathImpactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("symlink-entry"),
    locatorPrefix: nonEmptyFileRootRelativePathSchema,
    root: fileRootSchema,
  }),
  z.object({
    canonicalBackingPrefix: nonEmptyFileRootRelativePathSchema,
    kind: z.literal("regular"),
    locatorPrefix: nonEmptyFileRootRelativePathSchema,
    root: fileRootSchema,
  }),
]);
export type FilePathImpact = z.infer<typeof filePathImpactSchema>;

export const fileConfirmDurabilityResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confirmed"),
    revision: z.string().min(1),
  }),
  z.object({ kind: z.literal("revision-mismatch") }),
  z.object({
    kind: z.literal("failed"),
    message: z.string().min(1),
  }),
]);
export type FileConfirmDurabilityResult = z.infer<
  typeof fileConfirmDurabilityResultSchema
>;

export interface FileStatResult {
  exists: boolean;
  isDirectory: boolean;
  mtimeMs: number | null;
  path: string;
  root: string;
  size: number | null;
}

// v1 兼容结果；新代码使用 FileDocumentWriteResult。
export interface FileWriteTextResult {
  mtimeMs: number;
  path: string;
  root: string;
  written: true;
}

export interface FileMoveResult {
  moved: true;
  newPath: string;
  oldPath: string;
  root: string;
}

export interface FileCopyResult {
  copied: true;
  newPath: string;
  oldPath: string;
  root: string;
}

export interface FileRevealResult {
  path: string;
  revealed: boolean;
  root: string;
}

export interface FileTrashResult {
  path: string;
  root: string;
  trashed: true;
}

export interface FileMkdirResult {
  created: true;
  path: string;
  root: string;
}

export interface FileExistsResult {
  exists: boolean;
  path: string;
  root: string;
}
