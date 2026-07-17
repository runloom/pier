/**
 * File path query — Zod schemas shared between main and renderer.
 *
 * Path mode only (v1). Design: docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.1
 */
import { z } from "zod";

/** Top-K hard cap: never accept more than 200 items (design "Global Constraints"). */
export const FILE_PATH_QUERY_LIMIT_MAX = 200;
export const FILE_PATH_QUERY_LIMIT_DEFAULT = 200;
/** MRU hint cap: renderer must keep MRU ≤ 100 (design "Global Constraints"). */
export const FILE_PATH_QUERY_MRU_MAX = 100;

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

const fileQueryEventStartedSchema = z
  .object({
    kind: z.literal("started"),
    queryId: z.string().min(1).max(128),
  })
  .strict();

const fileQueryEventBatchSchema = z
  .object({
    kind: z.literal("batch"),
    queryId: z.string().min(1).max(128),
    items: z.array(filePathQueryItemSchema),
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

export const fileQueryEventSchema = z.discriminatedUnion("kind", [
  fileQueryEventStartedSchema,
  fileQueryEventBatchSchema,
  fileQueryEventDoneSchema,
  fileQueryEventErrorSchema,
]);
export type FileQueryEvent = z.infer<typeof fileQueryEventSchema>;
