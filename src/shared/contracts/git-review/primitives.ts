import { z } from "zod";

export const gitReviewOperationIdSchema = z.string().uuid();
export const gitReviewRevisionSchema = z.string().min(1).max(256);
export const gitReviewSectionKeySchema = z.string().min(1).max(512);
export const GIT_REVIEW_MAX_SECTIONS = 3;
/**
 * unstaged/staged/conflict 属于 uncommitted scope;committed 是 commit/branch
 * scope 的单一分组(range diff),两类分组不会出现在同一个 index 里。
 */
export const GIT_REVIEW_GROUP_ORDER = [
  "unstaged",
  "staged",
  "conflict",
  "committed",
] as const;
export type GitReviewGroup = (typeof GIT_REVIEW_GROUP_ORDER)[number];

export const GIT_REVIEW_STATUS_PRIORITY = [
  "conflicted",
  "renamed",
  "deleted",
  "added",
  "modified",
] as const;
export const gitReviewFileStatusSchema = z.enum(GIT_REVIEW_STATUS_PRIORITY);
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
    code: z.literal("pathDepthExceeded"),
    skipped: z.number().int().positive(),
  }),
  z.strictObject({
    code: z.literal("invalidPathEncoding"),
    skipped: z.number().int().positive(),
  }),
]);
export type GitReviewWarning = z.infer<typeof gitReviewWarningSchema>;

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

function hasUtf8ByteLengthAtMost(value: string, maxBytes: number): boolean {
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
