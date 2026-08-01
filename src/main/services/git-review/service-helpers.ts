import {
  type GitReviewFailure,
  type GitReviewMutationResult,
  gitReviewFailureSchema,
} from "../../../shared/contracts/git/review.ts";
import type { GitReviewBudget } from "./budget.ts";
import { toGitReviewIndexFailure } from "./index/execution.ts";
import { GitReviewSchedulerError } from "./scheduler/index.ts";

const GIT_REVIEW_MUTATION_RESULT_CACHE_LIMIT = 32;

export type GitReviewPreparedRequest<T> =
  | { readonly failure: GitReviewFailure; readonly kind: "failure" }
  | { readonly kind: "ready"; readonly request: T };

export function parseGitReviewServiceRequest<T>(
  schema: {
    safeParse: (
      input: unknown
    ) =>
      | { readonly success: false }
      | { readonly data: T; readonly success: true };
  },
  input: unknown,
  budget: GitReviewBudget,
  invalidMessage: string
): GitReviewPreparedRequest<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { kind: "ready", request: parsed.data };
  }
  budget.dispose();
  return {
    failure: gitReviewServiceFailure("invalidSource", false, invalidMessage),
    kind: "failure",
  };
}

export function rememberGitReviewMutationResult(
  cache: Map<
    string,
    {
      readonly requestIdentity: string;
      readonly result: GitReviewMutationResult;
    }
  >,
  operationId: string,
  requestIdentity: string,
  result: GitReviewMutationResult
): void {
  cache.delete(operationId);
  cache.set(operationId, { requestIdentity, result });
  while (cache.size > GIT_REVIEW_MUTATION_RESULT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    cache.delete(oldest);
  }
}

export async function settleGitReviewServiceLease<T>(lease: {
  readonly promise: Promise<T>;
}): Promise<T | GitReviewFailure> {
  try {
    return await lease.promise;
  } catch (error) {
    if (error instanceof GitReviewSchedulerError) {
      return toGitReviewSchedulerFailure(error);
    }
    return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
  }
}

export function gitReviewServiceFailure(
  reason: GitReviewFailure["reason"],
  retryable: boolean,
  message: string | null
): GitReviewFailure {
  return gitReviewFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}

function toGitReviewSchedulerFailure(
  error: GitReviewSchedulerError
): GitReviewFailure {
  if (error.reason === "busy") {
    return gitReviewServiceFailure("busy", true, error.message);
  }
  if (error.reason === "duplicate-operation") {
    return gitReviewServiceFailure("duplicateOperation", false, error.message);
  }
  if (error.reason === "timeout") {
    return gitReviewServiceFailure("timeout", true, error.message);
  }
  if (error.reason === "output-limit") {
    return gitReviewServiceFailure("outputLimit", true, error.message);
  }
  return gitReviewServiceFailure("aborted", true, error.message);
}
