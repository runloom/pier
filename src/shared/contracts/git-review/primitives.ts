import { z } from "zod";

export const gitObjectIdSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu)
  .transform((value) => value.toLowerCase());

export const gitReviewOperationIdSchema = z.string().uuid();
export const gitReviewRevisionSchema = z.string().min(1).max(256);
export const gitReviewSectionKeySchema = z.string().min(1).max(512);
export const GIT_REVIEW_PARSER_MAX_BYTES = 768 * 1024;
export const GIT_REVIEW_PARSER_MAX_LINES = 20_000;
export const GIT_REVIEW_PARSER_MAX_LINE_BYTES = 64 * 1024;
export const GIT_REVIEW_MAX_SECTIONS = 3;
export const gitRevisionInputSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !(
        value.startsWith("-") ||
        value.includes("\0") ||
        value.includes("\n") ||
        value.includes("\r")
      ),
    "Expected a safe Git revision argument"
  );

export const GIT_REVIEW_GROUP_ORDER = [
  "unstaged",
  "staged",
  "conflict",
  "commit",
  "branch",
] as const;
export const gitReviewGroupSchema = z.enum(GIT_REVIEW_GROUP_ORDER);
export type GitReviewGroup = z.infer<typeof gitReviewGroupSchema>;

export const gitReviewRenderableGroupSchema = z.enum([
  "unstaged",
  "staged",
  "commit",
  "branch",
]);

export const GIT_REVIEW_STATUS_PRIORITY = [
  "conflicted",
  "renamed",
  "deleted",
  "added",
  "modified",
] as const;
export const gitReviewFileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "conflicted",
]);
export type GitReviewFileStatus = z.infer<typeof gitReviewFileStatusSchema>;

export const gitReviewFailureReasonSchema = z.enum([
  "notRepository",
  "invalidSource",
  "staleRevision",
  "busy",
  "duplicateOperation",
  "aborted",
  "timeout",
  "outputLimit",
  "commandFailed",
  "readFailed",
  "internal",
]);
export type GitReviewFailureReason = z.infer<
  typeof gitReviewFailureReasonSchema
>;

/** reason 是稳定的用户文案映射键；message 只承载有界技术诊断。 */
export const gitReviewFailureSchema = z.strictObject({
  kind: z.literal("error"),
  message: z.string().max(4096).nullable(),
  reason: gitReviewFailureReasonSchema,
  retryable: z.boolean(),
});
export type GitReviewFailure = z.infer<typeof gitReviewFailureSchema>;

export const gitReviewWarningSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("filesTruncated"),
    limit: z.number().int().nonnegative(),
    omitted: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    code: z.literal("invalidPathEncoding"),
    skipped: z.number().int().positive(),
  }),
  z.strictObject({
    code: z.literal("renameDetectionLimited"),
    limit: z.number().int().positive(),
  }),
  z.strictObject({
    code: z.literal("entryStatsUnavailable"),
    count: z.number().int().positive(),
  }),
]);
export type GitReviewWarning = z.infer<typeof gitReviewWarningSchema>;

export const gitReviewCountSchema = z
  .number()
  .int()
  .safe()
  .nonnegative()
  .nullable();

export const gitReviewRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !(
        path.startsWith("/") ||
        path.includes("\0") ||
        path
          .split("/")
          .some(
            (segment) => segment === "" || segment === "." || segment === ".."
          )
      ),
    "Expected a root-relative Git path"
  );

export const gitReviewRootPathSchema = z
  .string()
  .min(1)
  .max(65_536)
  .refine(
    (path) =>
      !path.includes("\0") &&
      (path.startsWith("/") ||
        path.startsWith("\\\\") ||
        /^[A-Za-z]:[\\/]/u.test(path)) &&
      hasUtf8ByteLengthAtMost(path, 65_536),
    "Expected an absolute path within the 64 KiB UTF-8 routing limit"
  );

export function hasUtf8ByteLengthAtMost(
  value: string,
  maxBytes: number
): boolean {
  let byteLength = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x7f) {
      byteLength += 1;
    } else if (codePoint <= 0x7_ff) {
      byteLength += 2;
    } else if (codePoint <= 0xff_ff) {
      byteLength += 3;
    } else {
      byteLength += 4;
    }
    if (byteLength > maxBytes) {
      return false;
    }
  }
  return true;
}

export interface GitReviewParserTextMetrics {
  byteSize: number;
  lineCount: number;
  maxLineByteSize: number;
}

export function measureGitReviewParserText(
  value: string
): GitReviewParserTextMetrics {
  let byteSize = 0;
  let lineCount = 0;
  let currentLineByteSize = 0;
  let maxLineByteSize = 0;
  let endedWithLineBreak = false;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 10) {
      const lineByteSize =
        value.charCodeAt(index - 1) === 13
          ? currentLineByteSize - 1
          : currentLineByteSize;
      maxLineByteSize = Math.max(maxLineByteSize, lineByteSize);
      currentLineByteSize = 0;
      lineCount += 1;
      endedWithLineBreak = true;
      byteSize += 1;
      continue;
    }

    let characterByteSize: number;
    if (codeUnit <= 0x7f) {
      characterByteSize = 1;
    } else if (codeUnit <= 0x7_ff) {
      characterByteSize = 2;
    } else if (
      codeUnit >= 0xd8_00 &&
      codeUnit <= 0xdb_ff &&
      value.charCodeAt(index + 1) >= 0xdc_00 &&
      value.charCodeAt(index + 1) <= 0xdf_ff
    ) {
      characterByteSize = 4;
      index += 1;
    } else {
      characterByteSize = 3;
    }
    byteSize += characterByteSize;
    currentLineByteSize += characterByteSize;
    endedWithLineBreak = false;
  }

  if (value.length > 0 && !endedWithLineBreak) {
    lineCount += 1;
    maxLineByteSize = Math.max(maxLineByteSize, currentLineByteSize);
  }

  return { byteSize, lineCount, maxLineByteSize };
}

export function isGitReviewParserMetricsAdmitted(
  metrics: GitReviewParserTextMetrics
): boolean {
  return (
    metrics.byteSize <= GIT_REVIEW_PARSER_MAX_BYTES &&
    metrics.lineCount <= GIT_REVIEW_PARSER_MAX_LINES &&
    metrics.maxLineByteSize <= GIT_REVIEW_PARSER_MAX_LINE_BYTES
  );
}
