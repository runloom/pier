import { fingerprintGitReviewSource } from "./git-review-fingerprint.ts";
import {
  GIT_REVIEW_OBSERVATION_STAGE_PHASES,
  GIT_REVIEW_OPERATION_KINDS,
  type GitReviewCommandObservation,
  type GitReviewFailureReason,
  type GitReviewLogTrigger,
  type GitReviewObservationEvent,
  type GitReviewObservationPhase,
  type GitReviewObservationResult,
  type GitReviewObservationStart,
  type GitReviewObserverOptions,
  type GitReviewObserverSnapshot,
  type GitReviewOperationAggregate,
  type GitReviewOperationKind,
  type GitReviewOperationState,
  type GitReviewSettleObservation,
  type GitReviewStageDuration,
  type GitReviewStageObservation,
  type GitReviewStagePhase,
  type GitReviewStructuredLog,
} from "./git-review-observer-contract.ts";
import type { GitReviewCancellationReason } from "./git-review-operation.ts";

export const GIT_REVIEW_SLOW_QUEUE_MS = 250;
export const GIT_REVIEW_SLOW_DOCUMENT_MS = 1000;
export const GIT_REVIEW_SLOW_INDEX_MS = 2000;

interface ActiveGitReviewObservation {
  cacheHit: boolean;
  commandCount: number;
  dedupeHit: boolean;
  operationId: string;
  operationKind: GitReviewOperationKind;
  queryKind: GitReviewObservationStart["queryKind"];
  queuedAtMs: number;
  queueWaitMs: number;
  sourceHash: string;
  stageDurationMs: Partial<Record<GitReviewStagePhase, number>>;
  state: "queued" | "running";
  stderrBytes: number;
  stdoutBytes: number;
}

interface MutableAggregate {
  cancelled: number;
  settled: number;
  started: number;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function addFinite(left: number, right: number, name: string): number {
  const result = left + right;
  assertNonNegativeFinite(result, name);
  return result;
}

function addSafeInteger(left: number, right: number, name: string): number {
  const result = left + right;
  assertNonNegativeSafeInteger(result, name);
  return result;
}

function incrementSaturated(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function emptyAggregates(): Record<GitReviewOperationKind, MutableAggregate> {
  return Object.fromEntries(
    GIT_REVIEW_OPERATION_KINDS.map((kind) => [
      kind,
      { cancelled: 0, settled: 0, started: 0 },
    ])
  ) as Record<GitReviewOperationKind, MutableAggregate>;
}

function immutableStages(
  stageDurationMs: Readonly<Partial<Record<GitReviewStagePhase, number>>>
): readonly GitReviewStageDuration[] {
  return Object.freeze(
    GIT_REVIEW_OBSERVATION_STAGE_PHASES.flatMap((phase) => {
      const durationMs = stageDurationMs[phase];
      return durationMs === undefined
        ? []
        : [Object.freeze({ durationMs, phase })];
    })
  );
}

function logTriggers(
  event: GitReviewObservationEvent
): readonly GitReviewLogTrigger[] {
  const triggers: GitReviewLogTrigger[] = [];
  if (event.queueWaitMs > GIT_REVIEW_SLOW_QUEUE_MS) {
    triggers.push("slow-queue");
  }
  if (
    (event.operationKind === "document" &&
      event.durationMs > GIT_REVIEW_SLOW_DOCUMENT_MS) ||
    (event.operationKind === "index" &&
      event.durationMs > GIT_REVIEW_SLOW_INDEX_MS)
  ) {
    triggers.push("slow-operation");
  }
  if (
    event.result === "failure" ||
    event.result === "busy" ||
    event.failureReason !== null
  ) {
    triggers.push("failure");
  }
  if (
    event.result === "budget-exceeded" ||
    event.abortReason === "timeout" ||
    event.abortReason === "output-limit" ||
    event.abortReason === "file-limit"
  ) {
    triggers.push("budget");
  }
  return Object.freeze(triggers);
}

function structuredLog(
  event: GitReviewObservationEvent,
  triggers: readonly GitReviewLogTrigger[]
): GitReviewStructuredLog {
  return Object.freeze({
    abortReason: event.abortReason,
    cacheHit: event.cacheHit,
    commandCount: event.commandCount,
    dedupeHit: event.dedupeHit,
    durationMs: event.durationMs,
    event: "git-review-operation",
    failureReason: event.failureReason,
    operationId: event.operationId,
    operationKind: event.operationKind,
    queryKind: event.queryKind,
    queueWaitMs: event.queueWaitMs,
    result: event.result,
    sourceHash: event.sourceHash,
    stages: event.stages,
    state: event.state,
    stderrBytes: event.stderrBytes,
    stdoutBytes: event.stdoutBytes,
    triggers,
  });
}

function defaultStructuredLogger(entry: GitReviewStructuredLog): void {
  console.warn("[git-review] operation", entry);
}

export class GitReviewObserver {
  readonly #active = new Map<string, ActiveGitReviewObservation>();
  readonly #aggregates = emptyAggregates();
  readonly #fingerprinter: (parts: readonly string[]) => string;
  readonly #logger: (entry: GitReviewStructuredLog) => void;
  readonly #now: () => number;
  readonly #onEvent: ((event: GitReviewObservationEvent) => void) | undefined;

  constructor(options: GitReviewObserverOptions = {}) {
    this.#fingerprinter = options.fingerprinter ?? fingerprintGitReviewSource;
    this.#logger = options.logger ?? defaultStructuredLogger;
    this.#now = options.now ?? Date.now;
    this.#onEvent = options.onEvent;
  }

  queued(input: GitReviewObservationStart): void {
    if (this.#active.has(input.operationId)) {
      throw new Error(
        `git review operation is already active: ${input.operationId}`
      );
    }
    const atMs = this.#now();
    const observation: ActiveGitReviewObservation = {
      cacheHit: input.cacheHit ?? false,
      commandCount: 0,
      dedupeHit: input.dedupeHit ?? false,
      operationId: input.operationId,
      operationKind: input.operationKind,
      queryKind: input.queryKind,
      queuedAtMs: atMs,
      queueWaitMs: 0,
      sourceHash: this.#fingerprinter(input.sourceFingerprintParts),
      stageDurationMs: {},
      state: "queued",
      stderrBytes: 0,
      stdoutBytes: 0,
    };
    this.#active.set(input.operationId, observation);
    this.#aggregates[input.operationKind].started = incrementSaturated(
      this.#aggregates[input.operationKind].started
    );
    this.#publish(this.#event(observation, atMs, "queue", null, null, null));
  }

  running(operationId: string): boolean {
    const observation = this.#active.get(operationId);
    if (observation?.state !== "queued") {
      return false;
    }
    const atMs = this.#now();
    observation.queueWaitMs = Math.max(0, atMs - observation.queuedAtMs);
    observation.state = "running";
    this.#publish(
      this.#event(observation, atMs, "operation", null, null, null)
    );
    return true;
  }

  stage(operationId: string, input: GitReviewStageObservation): boolean {
    assertNonNegativeFinite(input.durationMs, "stage durationMs");
    const observation = this.#active.get(operationId);
    if (observation?.state !== "running") {
      return false;
    }
    observation.stageDurationMs[input.phase] = addFinite(
      observation.stageDurationMs[input.phase] ?? 0,
      input.durationMs,
      "stage cumulative durationMs"
    );
    this.#publish(
      this.#event(observation, this.#now(), input.phase, null, null, null)
    );
    return true;
  }

  command(operationId: string, input: GitReviewCommandObservation): boolean {
    assertNonNegativeSafeInteger(input.stdoutBytes, "stdoutBytes");
    assertNonNegativeSafeInteger(input.stderrBytes, "stderrBytes");
    const observation = this.#active.get(operationId);
    if (observation?.state !== "running") {
      return false;
    }
    const nextCommandCount = addSafeInteger(
      observation.commandCount,
      1,
      "commandCount"
    );
    const nextStdoutBytes = addSafeInteger(
      observation.stdoutBytes,
      input.stdoutBytes,
      "cumulative stdoutBytes"
    );
    const nextStderrBytes = addSafeInteger(
      observation.stderrBytes,
      input.stderrBytes,
      "cumulative stderrBytes"
    );
    observation.commandCount = nextCommandCount;
    observation.stdoutBytes = nextStdoutBytes;
    observation.stderrBytes = nextStderrBytes;
    return true;
  }

  cache(
    operationId: string,
    input: { cacheHit?: boolean; dedupeHit?: boolean }
  ): boolean {
    const observation = this.#active.get(operationId);
    if (!observation) {
      return false;
    }
    observation.cacheHit ||= input.cacheHit ?? false;
    observation.dedupeHit ||= input.dedupeHit ?? false;
    return true;
  }

  settled(operationId: string, input: GitReviewSettleObservation): boolean {
    return this.#terminal(
      operationId,
      "settled",
      input.result,
      null,
      input.failureReason ?? null
    );
  }

  cancelled(
    operationId: string,
    abortReason: GitReviewCancellationReason
  ): boolean {
    return this.#terminal(
      operationId,
      "cancelled",
      "aborted",
      abortReason,
      null
    );
  }

  snapshot(): GitReviewObserverSnapshot {
    const byOperationKind = Object.fromEntries(
      GIT_REVIEW_OPERATION_KINDS.map((kind) => {
        const aggregate = this.#aggregates[kind];
        const immutable: GitReviewOperationAggregate = Object.freeze({
          cancelled: aggregate.cancelled,
          settled: aggregate.settled,
          started: aggregate.started,
        });
        return [kind, immutable];
      })
    ) as Record<GitReviewOperationKind, GitReviewOperationAggregate>;
    return Object.freeze({
      active: this.#active.size,
      byOperationKind: Object.freeze(byOperationKind),
    });
  }

  #event(
    observation: ActiveGitReviewObservation,
    atMs: number,
    phase: GitReviewObservationPhase,
    result: GitReviewObservationResult | null,
    abortReason: GitReviewCancellationReason | null,
    failureReason: GitReviewFailureReason | null,
    state: GitReviewOperationState = observation.state
  ): GitReviewObservationEvent {
    return Object.freeze({
      abortReason,
      atMs,
      cacheHit: observation.cacheHit,
      commandCount: observation.commandCount,
      dedupeHit: observation.dedupeHit,
      durationMs: Math.max(0, atMs - observation.queuedAtMs),
      failureReason,
      operationId: observation.operationId,
      operationKind: observation.operationKind,
      phase,
      queryKind: observation.queryKind,
      queueWaitMs: observation.queueWaitMs,
      result,
      sourceHash: observation.sourceHash,
      stages: immutableStages(observation.stageDurationMs),
      state,
      stderrBytes: observation.stderrBytes,
      stdoutBytes: observation.stdoutBytes,
    });
  }

  #publish(event: GitReviewObservationEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Observer sink failures must not change scheduler/service control flow.
    }
  }

  #terminal(
    operationId: string,
    state: "settled" | "cancelled",
    result: GitReviewObservationResult,
    abortReason: GitReviewCancellationReason | null,
    failureReason: GitReviewFailureReason | null
  ): boolean {
    const observation = this.#active.get(operationId);
    if (!observation) {
      return false;
    }
    const atMs = this.#now();
    if (observation.state === "queued") {
      observation.queueWaitMs = Math.max(0, atMs - observation.queuedAtMs);
    }
    this.#active.delete(operationId);
    this.#aggregates[observation.operationKind][state] = incrementSaturated(
      this.#aggregates[observation.operationKind][state]
    );
    const event = this.#event(
      observation,
      atMs,
      "operation",
      result,
      abortReason,
      failureReason,
      state
    );
    this.#publish(event);
    const triggers = logTriggers(event);
    if (triggers.length > 0) {
      try {
        this.#logger(structuredLog(event, triggers));
      } catch {
        // Logging is deliberately observational and cannot retain an operation.
      }
    }
    return true;
  }
}

export function createGitReviewObserver(
  options: GitReviewObserverOptions = {}
): GitReviewObserver {
  return new GitReviewObserver(options);
}
