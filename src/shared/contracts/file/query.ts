/**
 * File path + content query — Zod schemas shared between main and renderer.
 *
 * Path mode: docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.1
 * Content mode: docs/superpowers/specs/2026-07-27-files-content-search-design.md §4
 */
import { z } from "zod";

/** Top-K hard cap: never accept more than 200 items (design "Global Constraints"). */
export const FILE_PATH_QUERY_LIMIT_MAX = 200;
export const FILE_PATH_QUERY_LIMIT_DEFAULT = 200;
/** MRU hint cap: renderer must keep MRU ≤ 100 (design "Global Constraints"). */
export const FILE_PATH_QUERY_MRU_MAX = 100;

/** Content search result hard cap (design §4.1). */
export const FILE_CONTENT_QUERY_RESULTS_MAX = 10_000;
export const FILE_CONTENT_QUERY_RESULTS_DEFAULT = 2000;
/** Default single-file size skip threshold for content search. */
export const FILE_CONTENT_QUERY_MAX_FILE_SIZE_BYTES_DEFAULT = 1_048_576;
/** Preview line transport cap (characters). */
export const FILE_CONTENT_QUERY_PREVIEW_MAX_CHARS = 500;

const relativePosixPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !v.includes("\0"), "path must not contain NUL")
  .refine((v) => !v.startsWith("/"), "path must be repo-relative")
  .refine((v) => !/(^|\/)\.\.(\/|$)/.test(v), "path must not contain '..'");

export const filePathQueryOptionsSchema = z
  .object({
    /** default true — hide git-ignored paths from search (design §4.2). */
    applyGitIgnore: z.boolean().optional(),
    /** default true — merge user + built-in exclude patterns (design §4.2). */
    applyExcludePatterns: z.boolean().optional(),
    /** multiline glob string; falls back to Files tree default excludes. */
    excludePatterns: z.string().max(16_384).optional(),
  })
  .strict();
export type FilePathQueryOptions = z.infer<typeof filePathQueryOptionsSchema>;

export const filePathQueryStartSchema = z
  .object({
    /** Optional explicit mode; omit or "path" for path ranking. */
    mode: z.literal("path").optional(),
    /** unique per session; used for cancel + event correlation. */
    queryId: z.string().min(1).max(128),
    /** origin tag: "quick-open:<sessionId>" | "tree-search:<instanceId>". */
    owner: z.string().min(1).max(128),
    /** canonical absolute project root path. */
    root: z.string().min(1),
    /** raw user input; main normalizes. Empty ⇒ shallow/MRU listing. */
    query: z.string().max(1024),
    limit: z
      .number()
      .int()
      .min(1)
      .max(FILE_PATH_QUERY_LIMIT_MAX)
      .default(FILE_PATH_QUERY_LIMIT_DEFAULT),
    mruPaths: z
      .array(relativePosixPathSchema)
      .max(FILE_PATH_QUERY_MRU_MAX)
      .optional(),
    options: filePathQueryOptionsSchema.optional(),
  })
  .strict();
export type FilePathQueryStart = z.infer<typeof filePathQueryStartSchema>;
/** Wire/input shape — `limit` optional thanks to schema default. */
export type FilePathQueryStartInput = z.input<typeof filePathQueryStartSchema>;

export const fileContentQueryOptionsSchema = z
  .object({
    /** default false — case-insensitive like typical editor search. */
    caseSensitive: z.boolean().optional(),
    /** default false. */
    wholeWord: z.boolean().optional(),
    /** default false — treat query as fixed string. */
    regexp: z.boolean().optional(),
    // Single include glob (e.g. "*.ts", "src/**/*.tsx").
    include: z.string().max(1024).optional(),
    /** multiline glob string; falls back to Files tree default excludes. */
    excludePatterns: z.string().max(16_384).optional(),
    /** default true — respect VCS ignore files. */
    applyGitIgnore: z.boolean().optional(),
    /** default true — apply excludePatterns / defaults. */
    applyExcludePatterns: z.boolean().optional(),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(FILE_CONTENT_QUERY_RESULTS_MAX)
      .optional(),
    maxFileSizeBytes: z
      .number()
      .int()
      .min(1)
      .max(64 * 1024 * 1024)
      .optional(),
    /** root-relative directory scope (single folder find-in). */
    scopeDir: relativePosixPathSchema.optional(),
  })
  .strict();
export type FileContentQueryOptions = z.infer<
  typeof fileContentQueryOptionsSchema
>;

export const fileContentQueryStartSchema = z
  .object({
    mode: z.literal("content"),
    queryId: z.string().min(1).max(128),
    /** origin tag: "content-search:<panelId>". */
    owner: z.string().min(1).max(128),
    root: z.string().min(1),
    /** empty ⇒ immediate completed with no batches. */
    query: z.string().max(1024),
    options: fileContentQueryOptionsSchema.optional(),
  })
  .strict();
export type FileContentQueryStart = z.infer<typeof fileContentQueryStartSchema>;
export type FileContentQueryStartInput = z.input<
  typeof fileContentQueryStartSchema
>;

export type FileQueryStart = FilePathQueryStart | FileContentQueryStart;
export type FileQueryStartInput =
  | FilePathQueryStartInput
  | FileContentQueryStartInput;

export function isFileContentQueryStart(
  request: FileQueryStart
): request is FileContentQueryStart {
  return "mode" in request && request.mode === "content";
}

export const filePathQueryCancelSchema = z
  .object({
    queryId: z.string().min(1).max(128),
  })
  .strict();
export type FilePathQueryCancel = z.infer<typeof filePathQueryCancelSchema>;

export const filePathQueryItemSchema = z
  .object({
    /** root-relative posix path. */
    path: relativePosixPathSchema,
    score: z.number(),
  })
  .strict();
export type FilePathQueryItem = z.infer<typeof filePathQueryItemSchema>;

export const fileContentQueryItemSchema = z
  .object({
    /** root-relative posix path. */
    path: relativePosixPathSchema,
    /** 1-based line number. */
    line: z.number().int().min(1),
    /**
     * Inclusive UTF-16 index of the match start within the full line text
     * (EOL stripped). Use for editor reveal against LF-normalized buffers.
     */
    matchCharStart: z.number().int().min(0),
    /** Exclusive UTF-16 index of the match end within the full line text. */
    matchCharEnd: z.number().int().min(0),
    /**
     * Inclusive file UTF-8 byte offset of the match start (on-disk).
     * Not safe for reveal on EOL/BOM-normalized editor buffers.
     */
    matchByteStart: z.number().int().min(0),
    /** Exclusive file UTF-8 byte offset of the match end (on-disk). */
    matchByteEnd: z.number().int().min(0),
    /** Line text without EOL; may be truncated for transport. */
    preview: z.string().max(2048),
    /** Match range within `preview` (after truncation adjustment). */
    previewMatchStart: z.number().int().min(0),
    previewMatchEnd: z.number().int().min(0),
  })
  .strict();
export type FileContentQueryItem = z.infer<typeof fileContentQueryItemSchema>;

const fileQueryEventStartedSchema = z
  .object({
    kind: z.literal("started"),
    queryId: z.string().min(1).max(128),
  })
  .strict();

const fileQueryEventBatchPathSchema = z
  .object({
    kind: z.literal("batch"),
    mode: z.literal("path"),
    queryId: z.string().min(1).max(128),
    items: z.array(filePathQueryItemSchema),
  })
  .strict();

const fileQueryEventBatchContentSchema = z
  .object({
    kind: z.literal("batch"),
    mode: z.literal("content"),
    queryId: z.string().min(1).max(128),
    items: z.array(fileContentQueryItemSchema),
  })
  .strict();

const fileQueryEventDoneSchema = z
  .object({
    kind: z.literal("done"),
    queryId: z.string().min(1).max(128),
    reason: z.enum(["completed", "cancelled"]),
    truncated: z.boolean(),
    scanned: z.number().int().min(0),
    elapsedMs: z.number().min(0),
  })
  .strict();

const fileQueryEventErrorSchema = z
  .object({
    kind: z.literal("error"),
    queryId: z.string().min(1).max(128),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2048),
  })
  .strict();

/**
 * Event wire schema. Plain `z.union` (not `discriminatedUnion("kind")`) because
 * path/content batches share `kind: "batch"` and discriminate on `mode`.
 */
export const fileQueryEventSchema = z.union([
  fileQueryEventStartedSchema,
  fileQueryEventBatchPathSchema,
  fileQueryEventBatchContentSchema,
  fileQueryEventDoneSchema,
  fileQueryEventErrorSchema,
]);

export type FileQueryEvent = z.infer<typeof fileQueryEventSchema>;

export type FileQueryBatchPathEvent = z.infer<
  typeof fileQueryEventBatchPathSchema
>;
export type FileQueryBatchContentEvent = z.infer<
  typeof fileQueryEventBatchContentSchema
>;
