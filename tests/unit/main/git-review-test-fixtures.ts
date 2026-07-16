import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import {
  GitReviewIndexReader,
  type ReadGitReviewIndexOptions,
  type ReadGitReviewIndexRequest,
} from "@main/services/git-review/git-review-index.ts";
import {
  type GitReviewRequestOptions,
  GitReviewService,
} from "@main/services/git-review/git-review-service.ts";
import type {
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexResult,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";

export const TEST_GIT_REVIEW_OWNER = Object.freeze({
  clientId: "test",
  generation: 0,
  windowRecordId: "test-window",
});

export function gitReviewRequestOptions(
  budget = new GitReviewBudget()
): GitReviewRequestOptions {
  return {
    budget,
    owner: TEST_GIT_REVIEW_OWNER,
    resolveSource: async <T extends GitReviewScope>(source: T) => ({
      kind: "ok" as const,
      value: source,
    }),
  };
}

/** 仅供底层单测显式补齐生产入口负责提供的 owner、预算与授权器。 */
export class TestGitReviewService extends GitReviewService {
  override getIndex(
    input: Parameters<GitReviewService["getIndex"]>[0],
    options?: Partial<GitReviewRequestOptions>
  ): Promise<GitReviewIndexResult> {
    const defaults = gitReviewRequestOptions(options?.budget);
    return super.getIndex(input, { ...defaults, ...options });
  }

  override getFileDocument(
    input: GitReviewFileDocumentRequest,
    options?: Partial<GitReviewRequestOptions>
  ): Promise<GitReviewFileDocumentResult> {
    const defaults = gitReviewRequestOptions(options?.budget);
    return super.getFileDocument(input, { ...defaults, ...options });
  }
}

/** IndexReader 是 main 内部层；单测在这里显式创建独立请求预算。 */
export class TestGitReviewIndexReader extends GitReviewIndexReader {
  override read(
    request: ReadGitReviewIndexRequest,
    options?: Partial<ReadGitReviewIndexOptions>
  ): Promise<GitReviewIndexResult> {
    const budget = options?.budget ?? new GitReviewBudget();
    return super.read(request, {
      budget,
      signal: options?.signal ?? budget.signal,
    });
  }

  override resolve(
    request: ReadGitReviewIndexRequest,
    options?: Partial<ReadGitReviewIndexOptions>
  ): ReturnType<GitReviewIndexReader["resolve"]> {
    const budget = options?.budget ?? new GitReviewBudget();
    return super.resolve(request, {
      budget,
      signal: options?.signal ?? budget.signal,
    });
  }
}
