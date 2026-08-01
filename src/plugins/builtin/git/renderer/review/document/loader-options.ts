import type {
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";

/**
 * content 正文水合并发（Zed 体感：不再用 2 当产品主路径）。
 * 测试可注入更小值。
 * @see 2026-07-31-git-review-zed-feel-design.md §4.1
 */
/** content 正文水合并发（大 staged 首屏：8 仍偏排队，抬到 12）。 */
export const DEFAULT_MAX_CONCURRENT_DOCUMENTS = 12;

export interface GitReviewDocumentLoaderOptions {
  readonly cancel: (operationId: string) => Promise<void>;
  readonly createOperationId?: () => string;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly load: (
    entry: GitReviewIndexEntry,
    operationId: string
  ) => Promise<GitReviewFileDocumentResult>;
  readonly maxConcurrent?: number;
  readonly maxRetainedBytes?: number;
  readonly maxRetainedLines?: number;
}
