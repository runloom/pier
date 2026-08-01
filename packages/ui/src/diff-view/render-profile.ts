/**
 * Pierre Diff 渲染配置单源（金标准）。
 * CodeView options 与 WorkerPool setRenderOptions 必须同值。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §8
 */

/** 安全终态：关闭 word 装饰，避免 Shiki Invalid decoration position。 */
export const PIER_DIFF_LINE_DIFF_TYPE = "none" as const;

export type PierDiffLineDiffType = typeof PIER_DIFF_LINE_DIFF_TYPE;
