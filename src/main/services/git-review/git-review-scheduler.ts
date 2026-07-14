import { GitReviewSharedExecutionBudget } from "./git-review-execution-budget.ts";
import {
  GIT_REVIEW_DEFAULT_FAILURE_REASON,
  type GitReviewCancellationReason,
  type GitReviewOperationLease,
  type GitReviewOperationTransition,
  type GitReviewScheduleRequest,
  type GitReviewScheduler,
  GitReviewSchedulerError,
  type GitReviewSchedulerOptions,
} from "./git-review-scheduler-contract.ts";
import {
  canRunGitReviewJob,
  createDeferredLease,
  createRejectedOperationLease,
  GitReviewActiveLeaseRegistry,
  type GitReviewDeferredLease,
  GitReviewSchedulerQueue,
  GitReviewSchedulerReservations,
  type GitReviewSharedJob,
  type GitReviewTransitionDeliveryContext,
  gitReviewOwnerToString,
  gitReviewScheduleKeyToString,
  gitReviewWatchLaneToString,
} from "./git-review-scheduler-internal.ts";
import { GitReviewSchedulerObserverBridge } from "./git-review-scheduler-observer.ts";
import {
  GIT_REVIEW_SCHEDULER_GLOBAL_PENDING,
  GIT_REVIEW_SCHEDULER_REPOSITORY_PENDING,
} from "./git-review-scheduler-policy.ts";

export type {
  GitReviewCancellationReason,
  GitReviewContentRequirement,
  GitReviewOperationLease,
  GitReviewOperationOwner,
  GitReviewOperationState,
  GitReviewRunContext,
  GitReviewScheduleIntent,
  GitReviewScheduleKey,
  GitReviewScheduleRequest,
  GitReviewScheduler,
  GitReviewSchedulerOptions,
  GitReviewSchedulerSnapshot,
} from "./git-review-scheduler-contract.ts";
export { GitReviewSchedulerError } from "./git-review-scheduler-contract.ts";

export function createGitReviewScheduler(
  options: GitReviewSchedulerOptions = {}
): GitReviewScheduler {
  const now = options.now ?? Date.now;
  const activeLeases = new GitReviewActiveLeaseRegistry();
  const jobsByKey = new Map<string, GitReviewSharedJob>();
  const queueState = new GitReviewSchedulerQueue(now);
  const reservations = new GitReviewSchedulerReservations();
  const observerBridge = new GitReviewSchedulerObserverBridge(options, now);

  function rejectRequest<T>(
    request: GitReviewScheduleRequest<T>,
    error: GitReviewSchedulerError,
    deduplicated: boolean,
    terminalState: "cancelled" | "settled"
  ): GitReviewOperationLease<T> {
    reservations.reserveOperation(request.operationId);
    request.budget.dispose();
    try {
      observerBridge.immediate(
        request,
        error,
        deduplicated,
        terminalState,
        () => reservations.releaseOperation(request.operationId)
      );
    } finally {
      reservations.releaseOperation(request.operationId);
    }
    return createRejectedOperationLease(request.operationId, error);
  }

  function terminalLease(
    lease: GitReviewDeferredLease,
    state: "cancelled" | "settled",
    reason: NonNullable<GitReviewOperationTransition["terminalReason"]>,
    outcome?:
      | { error: unknown; kind: "failure" }
      | { kind: "success"; value: unknown },
    deliveryContext?: GitReviewTransitionDeliveryContext
  ): void {
    if (lease.terminal) {
      return;
    }
    lease.terminal = true;
    lease.budget.signal.removeEventListener("abort", lease.abortListener);
    lease.budget.dispose();
    activeLeases.delete(lease);
    reservations.reserveOperation(lease.operationId);
    try {
      observerBridge.terminal(
        lease,
        state,
        reason,
        outcome,
        () => reservations.releaseOperation(lease.operationId),
        deliveryContext
      );
    } finally {
      reservations.releaseOperation(lease.operationId);
    }
  }

  function removeQueuedJob(job: GitReviewSharedJob): void {
    if (job.state !== "queued") {
      return;
    }
    queueState.removeQueued(job);
    if (jobsByKey.get(job.keyString) === job) {
      jobsByKey.delete(job.keyString);
    }
    job.state = "settled";
  }

  function cancelLease(
    operationId: string,
    reason: GitReviewCancellationReason = "caller",
    deliveryContext?: GitReviewTransitionDeliveryContext
  ): boolean {
    const record = activeLeases.get(operationId);
    if (record === undefined) {
      return false;
    }
    const { job, lease } = record;
    job.leases.delete(operationId);
    if (job.leases.size === 0) {
      if (job.state === "queued") {
        removeQueuedJob(job);
      } else if (job.state === "running") {
        if (reason === "output-limit" || reason === "timeout") {
          job.executionBudget?.noteFailure(reason);
        }
        if (jobsByKey.get(job.keyString) === job) {
          jobsByKey.delete(job.keyString);
        }
        job.controller.abort(reason);
      }
    }
    lease.reject(
      new GitReviewSchedulerError(reason, `Git Review operation ${reason}`)
    );
    terminalLease(lease, "cancelled", reason, undefined, deliveryContext);
    dispatch();
    return true;
  }

  function attachLease(
    job: GitReviewSharedJob,
    request: GitReviewScheduleRequest<unknown>,
    deduplicated: boolean
  ): GitReviewDeferredLease | GitReviewSchedulerError {
    if (job.executionBudget === undefined) {
      job.executionBudget = new GitReviewSharedExecutionBudget(
        job,
        cancelLease
      );
    }
    const admission = job.executionBudget.admitLateLease(request.budget);
    if (admission !== "ok") {
      request.budget.dispose();
      return new GitReviewSchedulerError(
        admission,
        `Git Review operation ${admission}`
      );
    }
    const lease = createDeferredLease({
      budget: request.budget,
      deduplicated,
      intent: request.intent,
      observeError:
        request.observation?.classifyError ??
        (() => ({
          failureReason: GIT_REVIEW_DEFAULT_FAILURE_REASON,
          result: "failure",
        })),
      observeResult:
        request.observation?.classifyResult ?? (() => ({ result: "success" })),
      operationId: request.operationId,
      owner: request.owner,
    });
    lease.abortListener = () => {
      cancelLease(lease.operationId, lease.budget.failureReason() ?? "timeout");
    };
    request.budget.signal.addEventListener("abort", lease.abortListener, {
      once: true,
    });
    job.leases.set(lease.operationId, lease);
    if (job.state === "queued" && request.intent === "manual-read") {
      job.intent = "manual-read";
    }
    activeLeases.add(job, lease);
    observerBridge.queued(request, deduplicated, lease);
    if (job.state === "running" && !lease.terminal) {
      observerBridge.running(lease);
    }
    return lease;
  }

  function finishJob(job: GitReviewSharedJob): void {
    job.state = "settled";
    queueState.finish(job);
    if (jobsByKey.get(job.keyString) === job) {
      jobsByKey.delete(job.keyString);
    }
    dispatch();
  }

  function beginSettlingJob(job: GitReviewSharedJob): void {
    job.state = "settling";
    if (jobsByKey.get(job.keyString) === job) {
      jobsByKey.delete(job.keyString);
    }
  }

  function startJob(job: GitReviewSharedJob): void {
    job.state = "running";
    queueState.start(job);
    const leasesAtStart = [...job.leases.values()];
    for (const lease of leasesAtStart) {
      if (!lease.terminal && job.leases.get(lease.operationId) === lease) {
        observerBridge.running(lease);
      }
    }
    if (!canRunGitReviewJob(job)) {
      finishJob(job);
      return;
    }
    const executionBudget = job.executionBudget;
    if (executionBudget === undefined) {
      throw new Error("Git Review job missing execution budget");
    }
    Promise.resolve()
      .then(() =>
        canRunGitReviewJob(job)
          ? job.run({ budget: executionBudget, signal: job.controller.signal })
          : undefined
      )
      .then(
        (value) => {
          beginSettlingJob(job);
          for (const lease of [...job.leases.values()]) {
            job.leases.delete(lease.operationId);
            lease.resolve(value);
            terminalLease(lease, "settled", "success", {
              kind: "success",
              value,
            });
          }
        },
        (error: unknown) => {
          beginSettlingJob(job);
          for (const lease of [...job.leases.values()]) {
            job.leases.delete(lease.operationId);
            lease.reject(error);
            terminalLease(lease, "settled", "failed", {
              error,
              kind: "failure",
            });
          }
        }
      )
      .finally(() => {
        finishJob(job);
      });
  }

  function dispatch(): void {
    while (true) {
      const job = queueState.takeNext();
      if (job === undefined) {
        return;
      }
      startJob(job);
    }
  }

  function supersedeTrailingWatch(laneKey: string): void {
    const existing = queueState.findQueuedWatch(laneKey);
    if (existing === undefined) {
      return;
    }
    removeQueuedJob(existing);
    for (const lease of [...existing.leases.values()]) {
      cancelLease(lease.operationId, "superseded");
    }
  }

  function schedule<T>(
    request: GitReviewScheduleRequest<T>
  ): GitReviewOperationLease<T> {
    if (
      activeLeases.has(request.operationId) ||
      reservations.isOperationReserved(request.operationId)
    ) {
      request.budget.dispose();
      return createRejectedOperationLease(
        request.operationId,
        new GitReviewSchedulerError(
          "duplicate-operation",
          `Duplicate Git Review operation ${request.operationId}`
        )
      );
    }
    const ownerKey = gitReviewOwnerToString(request.owner);
    if (reservations.isOwnerReserved(ownerKey)) {
      request.budget.dispose();
      return createRejectedOperationLease(
        request.operationId,
        new GitReviewSchedulerError(
          "owner-disposed",
          "Git Review operation owner is being released"
        )
      );
    }
    if (request.budget.signal.aborted) {
      const reason = request.budget.failureReason() ?? "timeout";
      return rejectRequest(
        request,
        new GitReviewSchedulerError(reason, `Git Review operation ${reason}`),
        false,
        "cancelled"
      );
    }
    const keyString = gitReviewScheduleKeyToString(request.key);
    const laneKey = gitReviewWatchLaneToString(request.key);
    const watchLaneVersion =
      request.intent === "watch"
        ? reservations.claimWatchLane(laneKey)
        : undefined;
    try {
      if (watchLaneVersion !== undefined) {
        supersedeTrailingWatch(laneKey);
        if (!reservations.isWatchLaneCurrent(laneKey, watchLaneVersion)) {
          return rejectRequest(
            request,
            new GitReviewSchedulerError(
              "superseded",
              "Git Review watch was superseded during scheduling"
            ),
            false,
            "cancelled"
          );
        }
      }
      const existing = jobsByKey.get(keyString);
      if (
        existing !== undefined &&
        (existing.state === "queued" || existing.state === "running") &&
        !existing.controller.signal.aborted &&
        request.intent !== "write" &&
        existing.intent !== "write"
      ) {
        if (activeLeases.capacityReached(request.owner, existing)) {
          return rejectRequest(
            request,
            new GitReviewSchedulerError(
              "busy",
              "Git Review lease capacity reached"
            ),
            true,
            "settled"
          );
        }
        const attached = attachLease(
          existing,
          request as GitReviewScheduleRequest<unknown>,
          true
        );
        if (attached instanceof GitReviewSchedulerError) {
          return rejectRequest(
            request,
            attached,
            true,
            attached.reason === "file-limit" ||
              attached.reason === "output-limit" ||
              attached.reason === "timeout"
              ? "cancelled"
              : "settled"
          );
        }
        return {
          cancel: (reason) => {
            cancelLease(request.operationId, reason);
          },
          operationId: request.operationId,
          promise: attached.promise as Promise<T>,
        };
      }
      if (activeLeases.capacityReached(request.owner)) {
        return rejectRequest(
          request,
          new GitReviewSchedulerError(
            "busy",
            "Git Review lease capacity reached"
          ),
          false,
          "settled"
        );
      }
      const repositoryPending = queueState.repositoryPending(
        request.key.repositoryKey
      );
      if (
        queueState.pendingJobs >= GIT_REVIEW_SCHEDULER_GLOBAL_PENDING ||
        repositoryPending >= GIT_REVIEW_SCHEDULER_REPOSITORY_PENDING
      ) {
        return rejectRequest(
          request,
          new GitReviewSchedulerError("busy", "Git Review scheduler is busy"),
          false,
          "settled"
        );
      }

      const job: GitReviewSharedJob = {
        controller: new AbortController(),
        intent: request.intent,
        key: request.key,
        keyString,
        laneKey,
        leases: new Map(),
        queuedAtMs: now(),
        run: request.run,
        state: "queued",
      };
      jobsByKey.set(keyString, job);
      queueState.enqueue(job);
      const attached = attachLease(
        job,
        request as GitReviewScheduleRequest<unknown>,
        false
      );
      if (attached instanceof GitReviewSchedulerError) {
        removeQueuedJob(job);
        return rejectRequest(
          request,
          attached,
          false,
          attached.reason === "file-limit" ||
            attached.reason === "output-limit" ||
            attached.reason === "timeout"
            ? "cancelled"
            : "settled"
        );
      }
      if (job.state === "queued" && job.leases.size > 0) {
        dispatch();
      }
      return {
        cancel: (reason) => {
          cancelLease(request.operationId, reason);
        },
        operationId: request.operationId,
        promise: attached.promise as Promise<T>,
      };
    } finally {
      if (watchLaneVersion !== undefined) {
        reservations.releaseWatchLane(laneKey, watchLaneVersion);
      }
    }
  }

  return {
    cancel: cancelLease,
    releaseOwner(owner, reason = "owner-disposed") {
      const ownerKey = gitReviewOwnerToString(owner);
      const operations = activeLeases.operationsForOwner(ownerKey);
      const deliveryContext = reservations.ownerDeliveryContext(ownerKey);
      reservations.reserveOwner(ownerKey);
      try {
        for (const operationId of operations) {
          cancelLease(operationId, reason, deliveryContext);
        }
      } finally {
        reservations.releaseOwner(ownerKey);
      }
      return operations.length;
    },
    schedule,
    snapshot: () => ({
      activeLeases: activeLeases.size,
      pendingJobs: queueState.pendingJobs,
      runningJobs: queueState.runningJobs,
    }),
  };
}
