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
});
export type FileWriteTextRequest = z.infer<typeof fileWriteTextRequestSchema>;

export const fileRenameRequestSchema = fileReadTextRequestSchema.extend({
  newPath: nonEmptyFileRootRelativePathSchema,
});
export type FileRenameRequest = z.infer<typeof fileRenameRequestSchema>;

export const fileMoveRequestSchema = fileRenameRequestSchema;
export type FileMoveRequest = z.infer<typeof fileMoveRequestSchema>;

export const fileTrashRequestSchema = fileReadTextRequestSchema;
export type FileTrashRequest = z.infer<typeof fileTrashRequestSchema>;

export const fileEntrySchema = z.object({
  kind: z.enum(["directory", "file"]),
  path: fileRootRelativePathSchema,
  root: fileRootSchema,
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const fileListResultSchema = z.array(fileEntrySchema);
export type FileListResult = z.infer<typeof fileListResultSchema>;

export interface FileWriteTextResult {
  path: string;
  root: string;
  written: true;
}

export interface FileRenameResult {
  newPath: string;
  oldPath: string;
  renamed: true;
  root: string;
}

export interface FileMoveResult {
  moved: true;
  newPath: string;
  oldPath: string;
  root: string;
}

export interface FileTrashResult {
  path: string;
  root: string;
  trashed: true;
}
