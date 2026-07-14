import {
  type GitReviewFailure,
  type GitReviewFileDocumentResult,
  gitReviewFailureSchema,
} from "../../../shared/contracts/git-review.ts";
import type { GitReviewSettleObservation } from "./git-review-observer-contract.ts";
import type { GitReviewSchedulerError } from "./git-review-scheduler.ts";

export function classifyGitReviewDocumentResult(
  value: GitReviewFileDocumentResult
): GitReviewSettleObservation {
  if (value.kind === "notModified") {
    return { result: "not-modified" };
  }
  if (value.kind !== "error") {
    return { result: "success" };
  }
  if (value.reason === "busy") {
    return { failureReason: "busy", result: "busy" };
  }
  if (value.reason === "timeout") {
    return { failureReason: "timeout", result: "budget-exceeded" };
  }
  if (value.reason === "outputLimit") {
    return { failureReason: "output-limit", result: "budget-exceeded" };
  }
  if (value.reason === "commandFailed") {
    return { failureReason: "command-failed", result: "failure" };
  }
  if (value.reason === "readFailed") {
    return { failureReason: "read-failed", result: "failure" };
  }
  if (value.reason === "staleRevision") {
    return { failureReason: "stale", result: "failure" };
  }
  if (value.reason === "invalidSource" || value.reason === "notRepository") {
    return { failureReason: "unsupported", result: "failure" };
  }
  return { failureReason: "internal", result: "failure" };
}

export function toGitReviewSchedulerFailure(
  error: GitReviewSchedulerError
): GitReviewFailure {
  if (error.reason === "busy") {
    return failure("busy", true, error.message);
  }
  if (error.reason === "duplicate-operation") {
    return failure("duplicateOperation", false, error.message);
  }
  if (error.reason === "timeout") {
    return failure("timeout", true, error.message);
  }
  if (error.reason === "output-limit" || error.reason === "file-limit") {
    return failure("outputLimit", true, error.message);
  }
  return failure("aborted", true, error.message);
}

function failure(
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
