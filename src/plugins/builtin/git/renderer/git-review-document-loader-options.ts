import type {
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";

export const DEFAULT_MAX_CONCURRENT_DOCUMENTS = 2;

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
