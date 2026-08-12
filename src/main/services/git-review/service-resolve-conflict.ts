import {
  type GitReviewConflictResolveRequest,
  type GitReviewMutationResult,
  getGitReviewFileSourceIdentity,
  gitReviewConflictResolveRequestSchema,
} from "../../../shared/contracts/git/review.ts";
import { execGitRaw } from "../git/exec.ts";
import { resolveGitReviewConflict } from "./document/conflict-resolve.ts";
import type { GitReviewIndexReader } from "./index/index.ts";
import type { GitReviewMutationWriter } from "./mutation.ts";
import type { GitReviewRepositoryCoordinator } from "./repository-coordinator.ts";
import type { GitReviewScheduler } from "./scheduler/index.ts";
import type { GitReviewRequestOptions } from "./service.ts";
import {
  gitReviewServiceFailure as failure,
  parseGitReviewServiceRequest as parseRequest,
  rememberGitReviewMutationResult,
  settleGitReviewServiceLease as settleReadLease,
} from "./service-helpers.ts";

type Scheduler = Pick<GitReviewScheduler, "schedule">;
type IndexReader = Pick<GitReviewIndexReader, "resolve">;

/**
 * Schedule conflict resolve (write / ours / theirs + stage) through the same
 * mutation lease path as other Git Review writes.
 */
export async function runGitReviewConflictResolve(options: {
  readonly completedMutations: Map<
    string,
    {
      readonly requestIdentity: string;
      readonly result: GitReviewMutationResult;
    }
  >;
  readonly indexReader: IndexReader;
  readonly input: GitReviewConflictResolveRequest;
  readonly repositoryCoordinator: GitReviewRepositoryCoordinator;
  readonly requestOptions: GitReviewRequestOptions & {
    readonly onCommitted?: (canonicalGitRootPath: string) => void;
    readonly writer: GitReviewMutationWriter;
  };
  readonly scheduler: Scheduler;
}): Promise<GitReviewMutationResult> {
  const {
    completedMutations,
    indexReader,
    input,
    repositoryCoordinator,
    requestOptions,
    scheduler,
  } = options;
  const prepared = parseRequest(
    gitReviewConflictResolveRequestSchema,
    input,
    requestOptions.budget,
    "Git Review conflict resolve 请求非法"
  );
  if (prepared.kind === "failure") {
    return prepared.failure;
  }
  const { request } = prepared;
  const mutationIdentity = JSON.stringify(request);
  const completed = completedMutations.get(request.operationId);
  if (completed !== undefined) {
    requestOptions.budget.dispose();
    return completed.requestIdentity === mutationIdentity
      ? completed.result
      : failure(
          "duplicateOperation",
          false,
          "The operation id was already used for a different Git change"
        );
  }
  const lease = scheduler.schedule<GitReviewMutationResult>({
    budget: requestOptions.budget,
    key: {
      canonicalRequestKey: request.operationId,
      operationKind: "mutation",
      repositoryKey: request.source.contextId,
      sourceKey: getGitReviewFileSourceIdentity(request.source),
    },
    operationId: request.operationId,
    owner: requestOptions.owner,
    run: async (context) => {
      const resolved = await requestOptions.resolveSource(
        request.source,
        context
      );
      if (resolved.kind === "error") {
        return resolved;
      }
      if (resolved.value.target.kind !== "uncommitted") {
        return failure(
          "invalidSource",
          false,
          "Only uncommitted Git review can resolve conflicts"
        );
      }
      const canonicalRequest = gitReviewConflictResolveRequestSchema.safeParse({
        ...request,
        source: resolved.value,
      });
      if (!canonicalRequest.success) {
        return failure(
          "invalidSource",
          false,
          "Git Review canonical conflict resolve source 非法"
        );
      }
      return repositoryCoordinator.runMutation(
        resolved.value.gitRootPath,
        context.signal,
        async () => {
          const result = await resolveGitReviewConflict({
            budget: context.budget,
            execGitRaw,
            indexReader,
            request: canonicalRequest.data,
            signal: context.signal,
            writer: requestOptions.writer,
          });
          if (result.kind !== "ok") {
            return result;
          }
          const committed = {
            ...result,
            stateSequence: repositoryCoordinator.recordMutation(
              resolved.value.gitRootPath
            ),
          };
          requestOptions.onCommitted?.(resolved.value.gitRootPath);
          return committed;
        }
      );
    },
  });
  const result = await settleReadLease(lease);
  rememberGitReviewMutationResult(
    completedMutations,
    request.operationId,
    mutationIdentity,
    result
  );
  return result;
}
