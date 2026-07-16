import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import type { GitReviewBudget } from "./git-review-budget.ts";
import type {
  GitReviewCancellationReason,
  GitReviewOperationKind,
} from "./git-review-operation.ts";

export type {
  GitReviewCancellationReason,
  GitReviewOperationKind,
} from "./git-review-operation.ts";

export type GitReviewExecutionBudget = GitExecExecutionBudget;

export interface GitReviewOperationOwner {
  clientId: string;
  generation: number;
  windowRecordId: string;
}

export interface GitReviewScheduleKey {
  canonicalRequestKey: string;
  operationKind: GitReviewOperationKind;
  repositoryKey: string;
  sourceKey: string;
}

export interface GitReviewRunContext {
  budget: GitReviewExecutionBudget;
  signal: AbortSignal;
}

export interface GitReviewScheduleRequest<T> {
  budget: GitReviewBudget;
  key: GitReviewScheduleKey;
  operationId: string;
  owner: GitReviewOperationOwner;
  run: (context: GitReviewRunContext) => Promise<T>;
}

export interface GitReviewOperationLease<T> {
  readonly promise: Promise<T>;
}

export class GitReviewSchedulerError extends Error {
  readonly reason: GitReviewCancellationReason | "busy" | "duplicate-operation";

  constructor(
    reason: GitReviewCancellationReason | "busy" | "duplicate-operation",
    message: string
  ) {
    super(message);
    this.name = "GitReviewSchedulerError";
    this.reason = reason;
  }
}

export interface GitReviewScheduler {
  cancelOwned: (
    operationId: string,
    owner: GitReviewOperationOwner,
    reason?: GitReviewCancellationReason
  ) => void;
  releaseOwner: (
    owner: GitReviewOperationOwner,
    reason?: GitReviewCancellationReason
  ) => void;
  schedule: <T>(
    request: GitReviewScheduleRequest<T>
  ) => GitReviewOperationLease<T>;
}
