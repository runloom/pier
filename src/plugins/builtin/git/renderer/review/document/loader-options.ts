import type {
  GitReviewExcerptBatchResult,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";

/**
 * Z1 单文件夹具并发；Z2 产品主路径用批摘录，见 GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT。
 */
export const DEFAULT_MAX_CONCURRENT_DOCUMENTS = 12;

/** Z2：1 个 excerpt 批 + 1 个选中项 boost。 */
export const GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT = 2;

export interface GitReviewDocumentLoaderOptions {
  readonly cancel: (operationId: string) => Promise<void>;
  readonly createOperationId?: () => string;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly load: (
    entry: GitReviewIndexEntry,
    operationId: string
  ) => Promise<GitReviewFileDocumentResult>;
  readonly loadBatch?: (
    entries: readonly GitReviewIndexEntry[],
    operationId: string
  ) => Promise<GitReviewExcerptBatchResult>;
  readonly maxConcurrent?: number;
  readonly maxRetainedBytes?: number;
  readonly maxRetainedLines?: number;
}
