import type {
  GitReviewCancellationReason,
  GitReviewOperationKind,
  GitReviewOperationState,
} from "./git-review-operation.ts";

export {
  GIT_REVIEW_OPERATION_KINDS,
  type GitReviewCancellationReason as GitReviewAbortReason,
  type GitReviewOperationKind,
  type GitReviewOperationState,
} from "./git-review-operation.ts";

export type GitReviewQueryKind = "branch" | "commit" | "uncommitted";

export const GIT_REVIEW_OBSERVATION_STAGE_PHASES = [
  "identity",
  "git",
  "parse",
  "assemble",
  "cache",
] as const;

export type GitReviewStagePhase =
  (typeof GIT_REVIEW_OBSERVATION_STAGE_PHASES)[number];

export type GitReviewObservationPhase =
  | "queue"
  | GitReviewStagePhase
  | "operation";

export type GitReviewObservationResult =
  | "success"
  | "not-modified"
  | "failure"
  | "busy"
  | "budget-exceeded"
  | "aborted";

export type GitReviewFailureReason =
  | "busy"
  | "command-failed"
  | "read-failed"
  | "permission-denied"
  | "index-locked"
  | "stale"
  | "unsupported"
  | "internal"
  | "timeout"
  | "output-limit"
  | "file-limit";

export interface GitReviewObservationStart {
  cacheHit?: boolean;
  dedupeHit?: boolean;
  operationId: string;
  operationKind: GitReviewOperationKind;
  queryKind: GitReviewQueryKind;
  /** 原始值仅供立即生成 HMAC；observer 不保留该数组或其中字符串。 */
  sourceFingerprintParts: readonly string[];
}

export interface GitReviewStageObservation {
  durationMs: number;
  phase: GitReviewStagePhase;
}

export interface GitReviewCommandObservation {
  stderrBytes: number;
  stdoutBytes: number;
}

export interface GitReviewSettleObservation {
  cacheHit?: boolean;
  failureReason?: GitReviewFailureReason;
  result: Exclude<GitReviewObservationResult, "aborted">;
}

export interface GitReviewStageDuration {
  readonly durationMs: number;
  readonly phase: GitReviewStagePhase;
}

export interface GitReviewObservationEvent {
  readonly abortReason: GitReviewCancellationReason | null;
  readonly atMs: number;
  readonly cacheHit: boolean;
  readonly commandCount: number;
  readonly dedupeHit: boolean;
  readonly durationMs: number;
  readonly failureReason: GitReviewFailureReason | null;
  readonly operationId: string;
  readonly operationKind: GitReviewOperationKind;
  readonly phase: GitReviewObservationPhase;
  readonly queryKind: GitReviewQueryKind;
  readonly queueWaitMs: number;
  readonly result: GitReviewObservationResult | null;
  readonly sourceHash: string;
  readonly stages: readonly GitReviewStageDuration[];
  readonly state: GitReviewOperationState;
  readonly stderrBytes: number;
  readonly stdoutBytes: number;
}

export type GitReviewLogTrigger =
  | "slow-queue"
  | "slow-operation"
  | "failure"
  | "budget";

export interface GitReviewStructuredLog
  extends Omit<GitReviewObservationEvent, "atMs" | "phase"> {
  readonly event: "git-review-operation";
  readonly triggers: readonly GitReviewLogTrigger[];
}

export interface GitReviewOperationAggregate {
  readonly cancelled: number;
  readonly settled: number;
  readonly started: number;
}

export interface GitReviewObserverSnapshot {
  readonly active: number;
  readonly byOperationKind: Readonly<
    Record<GitReviewOperationKind, GitReviewOperationAggregate>
  >;
}

export interface GitReviewObserverOptions {
  fingerprinter?: (parts: readonly string[]) => string;
  logger?: (entry: GitReviewStructuredLog) => void;
  now?: () => number;
  onEvent?: (event: GitReviewObservationEvent) => void;
}
