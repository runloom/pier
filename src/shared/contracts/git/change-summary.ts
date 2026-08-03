import { z } from "zod";

export const gitChangeSummaryUnavailableReasonSchema = z.enum([
  "commandFailed",
  "timeout",
  "budgetExceeded",
  "tooLarge",
  "invalidEncoding",
  "unsafePath",
  "readFailed",
  /** status/numstat（或同类）前后夹心取样不一致，属 TOCTOU 竞态而非命令失败。 */
  "inconsistent",
]);
export type GitChangeSummaryUnavailableReason = z.infer<
  typeof gitChangeSummaryUnavailableReasonSchema
>;

/**
 * 一个明确对比范围的变更摘要。
 * lineDelta 只汇总可统计的文本行；二进制、子模块、冲突、目录/嵌套仓等计入
 * excludedFiles（局部不可计不丢掉已算好的 +/-）。
 * filesOnly 仅表示整段摘要不可用（如 numstat 失败、status/numstat 不一致），
 * 调用方只能展示唯一文件数，禁止展示部分 +/−。
 */
export const gitChangeSummarySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    changedFiles: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    excludedFiles: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    kind: z.literal("lineDelta"),
  }),
  z.strictObject({
    changedFiles: z.number().int().nonnegative(),
    kind: z.literal("filesOnly"),
    omittedFiles: z.number().int().nonnegative(),
    reasons: z
      .array(gitChangeSummaryUnavailableReasonSchema)
      .min(1)
      .max(8)
      .refine(
        (reasons) => new Set(reasons).size === reasons.length,
        "Summary reasons must be unique"
      ),
  }),
]);
export type GitChangeSummary = z.infer<typeof gitChangeSummarySchema>;
