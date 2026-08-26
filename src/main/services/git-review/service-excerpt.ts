import {
  type GitReviewExcerptBatchRequest,
  type GitReviewExcerptBatchResult,
  gitReviewExcerptBatchRequestSchema,
} from "../../../shared/contracts/git/review.ts";
import type { GitReviewDocumentReader } from "./document/reader.ts";
import type { GitReviewRepositoryCoordinator } from "./repository-coordinator.ts";
import type { GitReviewScheduler } from "./scheduler/index.ts";
import type { GitReviewRequestOptions } from "./service.ts";
import {
  gitReviewServiceFailure as failure,
  parseGitReviewServiceRequest as parseRequest,
  settleGitReviewServiceLease as settleReadLease,
} from "./service-helpers.ts";

type Scheduler = Pick<GitReviewScheduler, "schedule">;
type DocumentReader = Pick<GitReviewDocumentReader, "executeBatch">;

/** 单世代批摘录：一次 lease，禁止每 path 再走 document 排队。 */
export async function runGitReviewExcerptBatch(options: {
  readonly documentReader: DocumentReader;
  readonly input: GitReviewExcerptBatchRequest;
  readonly repositoryCoordinator: GitReviewRepositoryCoordinator;
  readonly requestOptions: GitReviewRequestOptions;
  readonly scheduler: Scheduler;
}): Promise<GitReviewExcerptBatchResult> {
  const { documentReader, input, repositoryCoordinator, requestOptions } =
    options;
  const prepared = parseRequest(
    gitReviewExcerptBatchRequestSchema,
    input,
    requestOptions.budget,
    "Git Review excerpt 请求非法"
  );
  if (prepared.kind === "failure") {
    return prepared.failure;
  }
  const { request } = prepared;
  const requestIdentity = JSON.stringify([
    request.source.contextId,
    request.source.gitRootPath,
    request.source.target,
    request.files.map((file) => [
      file.path,
      file.oldPaths,
      file.previousRevision ?? null,
    ]),
  ]);
  const lease = options.scheduler.schedule<GitReviewExcerptBatchResult>({
    budget: requestOptions.budget,
    key: {
      canonicalRequestKey: requestIdentity,
      operationKind: "document",
      repositoryKey: request.source.contextId,
      sourceKey: JSON.stringify([
        request.source.contextId,
        request.source.target,
        request.files.map((file) => file.path),
      ]),
    },
    operationId: request.operationId,
    owner: requestOptions.owner,
    run: async (context) => {
      const source = await requestOptions.resolveSource(
        request.source,
        context
      );
      if (source.kind === "error") {
        return source;
      }
      const canonicalRequest = gitReviewExcerptBatchRequestSchema.safeParse({
        ...request,
        source: source.value,
      });
      if (!canonicalRequest.success) {
        return failure(
          "invalidSource",
          false,
          "Git Review canonical excerpt source 非法"
        );
      }
      return repositoryCoordinator.runConsistentRead(
        canonicalRequest.data.source.gitRootPath,
        context.signal,
        () =>
          documentReader.executeBatch(
            canonicalRequest.data,
            context.budget,
            context.signal
          )
      );
    },
  });
  return settleReadLease(lease);
}
