import type { GitReviewSettleObservation } from "./git-review-observer-contract.ts";
import type {
  GitReviewCancellationReason,
  GitReviewOperationTransition,
  GitReviewScheduleRequest,
  GitReviewSchedulerError,
  GitReviewSchedulerOptions,
} from "./git-review-scheduler-contract.ts";
import type {
  GitReviewDeferredLease,
  GitReviewTransitionDeliveryContext,
  GitReviewTransitionDeliveryGuard,
} from "./git-review-scheduler-internal.ts";

type TerminalState = "cancelled" | "settled";
type TerminalReason = NonNullable<
  GitReviewOperationTransition["terminalReason"]
>;
type TerminalOutcome =
  | { error: unknown; kind: "failure" }
  | { kind: "success"; value: unknown };

interface PendingTransition {
  readonly deliveryContext?: GitReviewTransitionDeliveryContext;
  readonly transition: GitReviewOperationTransition;
}

/**
 * 调度器到观测器的唯一生命周期适配边界。
 * 观测故障不得反向改变调度结果，状态转换回调同样只用于观测。
 */
export class GitReviewSchedulerObserverBridge {
  #flushingTransitions = false;
  readonly #now: () => number;
  readonly #options: GitReviewSchedulerOptions;
  readonly #pendingTransitions: PendingTransition[] = [];
  #transitionHead = 0;
  #transactionDepth = 0;

  constructor(options: GitReviewSchedulerOptions, now: () => number) {
    this.#now = now;
    this.#options = options;
  }

  immediate<T>(
    request: GitReviewScheduleRequest<T>,
    error: GitReviewSchedulerError,
    deduplicated: boolean,
    terminalState: TerminalState,
    releaseReservation: () => void
  ): void {
    this.queued(request, deduplicated);
    this.#publish(
      {
        deduplicated,
        operationId: request.operationId,
        state: terminalState,
        terminalReason: error.reason,
        timestampMs: this.#now(),
      },
      () => {
        if (terminalState === "cancelled") {
          this.#safely(() => {
            this.#options.observer?.cancelled(
              request.operationId,
              cancellationReason(error.reason)
            );
          });
          return;
        }
        this.#safely(() => {
          this.#options.observer?.settled(request.operationId, {
            failureReason: error.reason === "busy" ? "busy" : "internal",
            result: error.reason === "busy" ? "busy" : "failure",
          });
        });
      },
      releaseReservation
    );
  }

  queued<T>(
    request: GitReviewScheduleRequest<T>,
    deduplicated: boolean,
    lease?: GitReviewDeferredLease
  ): void {
    if (lease !== undefined) {
      if (lease.lifecycleState !== "created") {
        return;
      }
      lease.lifecycleState = "queued";
    }
    this.#publish(
      {
        deduplicated,
        operationId: request.operationId,
        state: "queued",
        timestampMs: this.#now(),
      },
      () => {
        const observation = request.observation;
        if (observation === undefined) {
          return;
        }
        this.#safely(() => {
          this.#options.observer?.queued({
            ...(observation.cacheHit === undefined
              ? {}
              : { cacheHit: observation.cacheHit }),
            dedupeHit: deduplicated,
            operationId: request.operationId,
            operationKind: request.key.operationKind,
            queryKind: observation.queryKind,
            sourceFingerprintParts: observation.sourceFingerprintParts,
          });
        });
      }
    );
  }

  running(lease: GitReviewDeferredLease): void {
    if (lease.lifecycleState !== "queued") {
      return;
    }
    lease.lifecycleState = "running";
    this.#publish(
      {
        deduplicated: lease.deduplicated,
        operationId: lease.operationId,
        state: "running",
        timestampMs: this.#now(),
      },
      () => {
        this.#safely(() => {
          this.#options.observer?.running(lease.operationId);
        });
      }
    );
  }

  terminal(
    lease: GitReviewDeferredLease,
    state: TerminalState,
    reason: TerminalReason,
    outcome: TerminalOutcome | undefined,
    releaseReservation: () => void,
    deliveryContext?: GitReviewTransitionDeliveryContext
  ): void {
    if (lease.lifecycleState === "terminal") {
      return;
    }
    lease.lifecycleState = "terminal";
    this.#publish(
      {
        deduplicated: lease.deduplicated,
        operationId: lease.operationId,
        state,
        terminalReason: reason,
        timestampMs: this.#now(),
      },
      () => {
        if (state === "cancelled") {
          this.#safely(() => {
            this.#options.observer?.cancelled(
              lease.operationId,
              cancellationReason(reason)
            );
          });
          return;
        }
        const observation = this.#classifyOutcome(lease, outcome);
        const cacheHit = observation.cacheHit;
        if (cacheHit !== undefined) {
          this.#safely(() => {
            this.#options.observer?.cache(lease.operationId, {
              cacheHit,
            });
          });
        }
        this.#safely(() => {
          this.#options.observer?.settled(lease.operationId, observation);
        });
      },
      releaseReservation,
      deliveryContext
    );
  }

  #classifyOutcome(
    lease: GitReviewDeferredLease,
    outcome: TerminalOutcome | undefined
  ): GitReviewSettleObservation {
    try {
      return outcome?.kind === "success"
        ? lease.observeResult(outcome.value)
        : lease.observeError(outcome?.error);
    } catch {
      return { failureReason: "internal", result: "failure" };
    }
  }

  #safely(action: () => void): void {
    try {
      action();
    } catch {
      // 观测适配器不参与调度控制流。
    }
  }

  #flushTransitions(): void {
    if (this.#flushingTransitions || this.#transactionDepth > 0) {
      return;
    }
    this.#flushingTransitions = true;
    try {
      while (this.#transitionHead < this.#pendingTransitions.length) {
        const pending = this.#pendingTransitions[this.#transitionHead];
        this.#transitionHead += 1;
        if (pending !== undefined) {
          this.#deliverTransition(pending);
        }
      }
    } finally {
      if (this.#transitionHead > 0) {
        this.#pendingTransitions.splice(0, this.#transitionHead);
        this.#transitionHead = 0;
      }
      this.#flushingTransitions = false;
    }
  }

  #deliverTransition(pending: PendingTransition): void {
    const acquired: GitReviewTransitionDeliveryGuard[] = [];
    try {
      for (const guard of pending.deliveryContext?.guards ?? []) {
        guard.acquire();
        acquired.push(guard);
      }
      this.#safely(() => this.#options.onTransition?.(pending.transition));
    } finally {
      for (let index = acquired.length - 1; index >= 0; index -= 1) {
        acquired[index]?.release();
      }
    }
  }

  #publish(
    transition: GitReviewOperationTransition,
    publishCanonical: () => void,
    afterCanonical: () => void = () => undefined,
    deliveryContext?: GitReviewTransitionDeliveryContext
  ): void {
    this.#pendingTransitions.push({
      ...(deliveryContext === undefined ? {} : { deliveryContext }),
      transition,
    });
    this.#transactionDepth += 1;
    try {
      publishCanonical();
    } finally {
      afterCanonical();
      this.#transactionDepth -= 1;
      this.#flushTransitions();
    }
  }
}

function cancellationReason(
  reason: TerminalReason
): GitReviewCancellationReason {
  return reason === "busy" ||
    reason === "duplicate-operation" ||
    reason === "failed" ||
    reason === "success"
    ? "caller"
    : reason;
}
