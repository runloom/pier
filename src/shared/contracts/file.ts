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

export const fileReadTextRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileReadTextRequest = z.infer<typeof fileReadTextRequestSchema>;

export const fileWriteTextRequestSchema = z.object({
  path: nonEmptyFileRootRelativePathSchema,
  root: fileRootSchema,
  contents: z.string(),
  expectedMtimeMs: z.number().nonnegative().optional(),
});
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

export const fileDraftsSetRequestSchema = z.object({
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

export interface FileStatResult {
  exists: boolean;
  isDirectory: boolean;
  mtimeMs: number | null;
  path: string;
  root: string;
  size: number | null;
}

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

export type FileDraftsListResult = Record<string, string>;

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
