import { isUtf8 } from "node:buffer";
import {
  type ExecGitRaw,
  GitExecRawError,
  type GitExecRawResult,
} from "../git-exec.ts";
import { GitReviewIdentityError } from "./git-review-identity.ts";
import {
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
  GitReviewIndexInputError,
  GitReviewIndexProtocolError,
} from "./git-review-index-contract.ts";

const GIT_REVIEW_FAILURE_MESSAGE_MAX_BYTES = 4096;

export async function runGitReviewIndexParser(
  execGitRaw: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined,
  onRecord: (record: Buffer) => "continue" | "stop"
): Promise<GitExecRawResult> {
  let protocolError: unknown;
  const result = await execGitRaw(args, {
    budget,
    cwd,
    maxRecords: null,
    mode: "stream",
    onRecord: (record) => {
      try {
        return onRecord(record);
      } catch (error) {
        protocolError = error;
        return "stop";
      }
    },
    ...(signal === undefined ? {} : { signal }),
  });
  if (protocolError !== undefined) {
    throw protocolError;
  }
  return result;
}

export function gitReviewIdentityExecutionOptions(
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined
): { budget: GitReviewIndexExecutionBudget; signal?: AbortSignal } {
  return { budget, ...(signal === undefined ? {} : { signal }) };
}

export function assertGitReviewIndexExecutionActive(
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined
): void {
  const failure = budget.failureReason();
  if (failure !== null) {
    throw new GitReviewIndexExecutionError(failure, `Git index ${failure}`);
  }
  if (signal?.aborted) {
    throw new GitReviewIndexExecutionError("aborted", "Git index 已取消");
  }
}

export function toGitReviewIndexFailure(error: unknown): {
  kind: "error";
  message: string | null;
  reason:
    | "aborted"
    | "commandFailed"
    | "internal"
    | "invalidSource"
    | "notRepository"
    | "outputLimit"
    | "timeout";
  retryable: boolean;
} {
  const message = truncateGitReviewFailureMessage(
    error instanceof Error ? error.message : String(error)
  );
  if (error instanceof GitReviewIndexInputError) {
    return {
      kind: "error",
      message,
      reason: "invalidSource",
      retryable: false,
    };
  }
  if (error instanceof GitExecRawError) {
    if (error.causeKind === "aborted") {
      return { kind: "error", message, reason: "aborted", retryable: true };
    }
    if (error.causeKind === "timeout") {
      return { kind: "error", message, reason: "timeout", retryable: true };
    }
    if (
      error.causeKind === "output-limit" ||
      error.causeKind === "record-limit"
    ) {
      return { kind: "error", message, reason: "outputLimit", retryable: true };
    }
    return { kind: "error", message, reason: "commandFailed", retryable: true };
  }
  if (error instanceof GitReviewIdentityError) {
    if (error.kind === "notRepository") {
      return {
        kind: "error",
        message,
        reason: "notRepository",
        retryable: false,
      };
    }
    if (error.kind === "timeout") {
      return { kind: "error", message, reason: "timeout", retryable: true };
    }
    if (error.kind === "outputLimit") {
      return { kind: "error", message, reason: "outputLimit", retryable: true };
    }
    if (error.kind === "aborted") {
      return { kind: "error", message, reason: "aborted", retryable: true };
    }
  }
  if (error instanceof GitReviewIndexProtocolError) {
    return {
      kind: "error",
      message,
      reason: "commandFailed",
      retryable: false,
    };
  }
  if (error instanceof GitReviewIndexExecutionError) {
    if (error.kind === "aborted") {
      return { kind: "error", message, reason: "aborted", retryable: true };
    }
    if (error.kind === "timeout") {
      return { kind: "error", message, reason: "timeout", retryable: true };
    }
    return { kind: "error", message, reason: "outputLimit", retryable: true };
  }
  return { kind: "error", message, reason: "internal", retryable: false };
}

function truncateGitReviewFailureMessage(message: string): string {
  const bytes = Buffer.from(message, "utf8");
  if (bytes.length <= GIT_REVIEW_FAILURE_MESSAGE_MAX_BYTES) {
    return message;
  }
  let end = GIT_REVIEW_FAILURE_MESSAGE_MAX_BYTES;
  while (end > 0 && !isUtf8(bytes.subarray(0, end))) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}
