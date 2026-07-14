import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import type { GitReviewBudget } from "./git-review-budget.ts";
import type { GitReviewObserver } from "./git-review-observer.ts";
import type {
  GitReviewFailureReason,
  GitReviewQueryKind,
  GitReviewSettleObservation,
} from "./git-review-observer-contract.ts";
import type {
  GitReviewCancellationReason,
  GitReviewOperationKind,
  GitReviewOperationState,
} from "./git-review-operation.ts";

export type {
  GitReviewCancellationReason,
  GitReviewOperationKind,
  GitReviewOperationState,
} from "./git-review-operation.ts";

export type GitReviewContentRequirement = "conditional" | "full";
export type GitReviewScheduleIntent = "manual-read" | "watch" | "write";

export interface GitReviewExecutionBudget extends GitExecExecutionBudget {
  tryConsumeFiles(delta?: number): boolean;
}

export interface GitReviewOperationOwner {
  clientId: string;
  generation: number;
  windowRecordId: string;
}

export interface GitReviewScheduleKey {
  canonicalRequestKey: string;
  contentRequirement: GitReviewContentRequirement;
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
  intent: GitReviewScheduleIntent;
  key: GitReviewScheduleKey;
  observation?: GitReviewScheduleObservation<T>;
  operationId: string;
  owner: GitReviewOperationOwner;
  run: (context: GitReviewRunContext) => Promise<T>;
}

export interface GitReviewScheduleObservation<T> {
  cacheHit?: boolean;
  classifyError?: (error: unknown) => GitReviewSettleObservation;
  classifyResult?: (value: T) => GitReviewSettleObservation;
  queryKind: GitReviewQueryKind;
  sourceFingerprintParts: readonly string[];
}

export interface GitReviewOperationTransition {
  deduplicated: boolean;
  operationId: string;
  state: GitReviewOperationState;
  terminalReason?:
    | GitReviewCancellationReason
    | "busy"
    | "duplicate-operation"
    | "failed"
    | "success";
  timestampMs: number;
}

export interface GitReviewSchedulerOptions {
  now?: () => number;
  observer?: Pick<
    GitReviewObserver,
    "cache" | "cancelled" | "queued" | "running" | "settled"
  >;
  onTransition?: (transition: GitReviewOperationTransition) => void;
}

export const GIT_REVIEW_DEFAULT_FAILURE_REASON: GitReviewFailureReason =
  "internal";

export interface GitReviewOperationLease<T> {
  cancel: (reason?: GitReviewCancellationReason) => void;
  readonly operationId: string;
  readonly promise: Promise<T>;
}

export interface GitReviewSchedulerSnapshot {
  activeLeases: number;
  pendingJobs: number;
  runningJobs: number;
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
  cancel: (
    operationId: string,
    reason?: GitReviewCancellationReason
  ) => boolean;
  releaseOwner: (
    owner: GitReviewOperationOwner,
    reason?: GitReviewCancellationReason
  ) => number;
  schedule: <T>(
    request: GitReviewScheduleRequest<T>
  ) => GitReviewOperationLease<T>;
  snapshot: () => GitReviewSchedulerSnapshot;
}
