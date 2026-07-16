import { GitReviewSharedExecutionBudget } from "./git-review-execution-budget.ts";
import {
  type GitReviewCancellationReason,
  type GitReviewOperationLease,
  type GitReviewScheduleRequest,
  type GitReviewScheduler,
  GitReviewSchedulerError,
} from "./git-review-scheduler-contract.ts";
import {
  canRunGitReviewJob,
  createDeferredLease,
  GitReviewActiveLeaseRegistry,
  type GitReviewDeferredLease,
  GitReviewSchedulerQueue,
  type GitReviewSharedJob,
  gitReviewOwnerToString,
  gitReviewScheduleKeyToString,
  gitReviewSourcePermitKey,
} from "./git-review-scheduler-internal.ts";
import {
  GIT_REVIEW_SCHEDULER_GLOBAL_DETACHED,
  GIT_REVIEW_SCHEDULER_GLOBAL_PENDING,
  GIT_REVIEW_SCHEDULER_REPOSITORY_DETACHED,
  GIT_REVIEW_SCHEDULER_REPOSITORY_PENDING,
} from "./git-review-scheduler-policy.ts";

export type {
  GitReviewCancellationReason,
  GitReviewExecutionBudget,
  GitReviewOperationLease,
  GitReviewOperationOwner,
  GitReviewRunContext,
  GitReviewScheduleKey,
  GitReviewScheduleRequest,
  GitReviewScheduler,
} from "./git-review-scheduler-contract.ts";
export { GitReviewSchedulerError } from "./git-review-scheduler-contract.ts";

export function createGitReviewScheduler(): GitReviewScheduler {
  const activeLeases = new GitReviewActiveLeaseRegistry();
  const detachedByJob = new Map<GitReviewSharedJob, Set<Promise<unknown>>>();
  const detachedByRepository = new Map<string, number>();
  const detachedBySource = new Map<string, number>();
  const jobsByKey = new Map<string, GitReviewSharedJob>();
  const queueState = new GitReviewSchedulerQueue();

  function trackDetachedOperation(
    job: GitReviewSharedJob,
    operation: Promise<unknown>
  ): void {
    let operations = detachedByJob.get(job);
    if (operations?.has(operation)) {
      return;
    }
    if (operations === undefined) {
      operations = new Set();
      detachedByJob.set(job, operations);
      incrementCounter(detachedByRepository, job.key.repositoryKey);
      incrementCounter(detachedBySource, gitReviewSourcePermitKey(job.key));
    }
    operations.add(operation);
    const release = (): void => {
      const current = detachedByJob.get(job);
      if (current === undefined || !current.delete(operation)) {
        return;
      }
      if (current.size > 0) {
        return;
      }
      detachedByJob.delete(job);
      decrementCounter(detachedByRepository, job.key.repositoryKey);
      decrementCounter(detachedBySource, gitReviewSourcePermitKey(job.key));
      dispatch();
    };
    operation.then(release, release);
  }

  function detachedAdmissionBlocked(key: GitReviewSharedJob["key"]): boolean {
    return (
      (detachedBySource.get(gitReviewSourcePermitKey(key)) ?? 0) > 0 ||
      (detachedByRepository.get(key.repositoryKey) ?? 0) >=
        GIT_REVIEW_SCHEDULER_REPOSITORY_DETACHED ||
      detachedByJob.size >= GIT_REVIEW_SCHEDULER_GLOBAL_DETACHED
    );
  }

  function hasDetachedCapacityFor(job: GitReviewSharedJob): boolean {
    return (
      detachedByJob.size + queueState.runningJobs <
        GIT_REVIEW_SCHEDULER_GLOBAL_DETACHED &&
      (detachedByRepository.get(job.key.repositoryKey) ?? 0) +
        queueState.repositoryRunning(job.key.repositoryKey) <
        GIT_REVIEW_SCHEDULER_REPOSITORY_DETACHED
    );
  }

  function rejectRequest<T>(
    request: GitReviewScheduleRequest<T>,
    error: GitReviewSchedulerError
  ): GitReviewOperationLease<T> {
    request.budget.dispose();
    const promise = Promise.reject<T>(error);
    promise.catch(() => undefined);
    return { promise };
  }

  function terminalLease(lease: GitReviewDeferredLease): void {
    if (lease.terminal) {
      return;
    }
    lease.terminal = true;
    lease.budget.signal.removeEventListener("abort", lease.abortListener);
    lease.budget.dispose();
    activeLeases.delete(lease);
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
    reason: GitReviewCancellationReason = "caller"
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
        if (job.runPromise !== undefined) {
          trackDetachedOperation(job, job.runPromise);
        }
        job.controller.abort(reason);
      }
    }
    lease.reject(
      new GitReviewSchedulerError(reason, `Git Review operation ${reason}`)
    );
    terminalLease(lease);
    dispatch();
    return true;
  }

  function attachLease(
    job: GitReviewSharedJob,
    request: GitReviewScheduleRequest<unknown>
  ): GitReviewDeferredLease | GitReviewSchedulerError {
    if (job.executionBudget === undefined) {
      job.executionBudget = new GitReviewSharedExecutionBudget(
        job,
        cancelLease,
        (operation) => trackDetachedOperation(job, operation)
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
    activeLeases.add(job, lease);
    return lease;
  }

  function finishJob(job: GitReviewSharedJob): void {
    if (job.state === "settled") {
      return;
    }
    const wasRunning = job.state === "running" || job.state === "settling";
    job.state = "settled";
    if (wasRunning) {
      queueState.finish(job);
    }
    if (jobsByKey.get(job.keyString) === job) {
      jobsByKey.delete(job.keyString);
    }
    dispatch();
  }

  function startJob(job: GitReviewSharedJob): void {
    job.state = "running";
    queueState.start(job);
    if (!canRunGitReviewJob(job)) {
      finishJob(job);
      return;
    }
    const executionBudget = job.executionBudget;
    if (executionBudget === undefined) {
      throw new Error("Git Review job missing execution budget");
    }

    const runPromise = Promise.resolve().then(() =>
      job.run({ budget: executionBudget, signal: job.controller.signal })
    );
    job.runPromise = runPromise;
    let runSettled = false;
    runPromise.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      }
    );
    // 某些平台文件系统调用不支持原生 AbortSignal。调度器必须在 owner
    // 释放或超时后立即归还许可，不能等待底层 Promise 自行结算。
    let removeAbortListener = (): void => undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectAborted = (): void => {
        const reason = cancellationReason(job.controller.signal.reason);
        reject(
          new GitReviewSchedulerError(reason, `Git Review operation ${reason}`)
        );
      };
      if (job.controller.signal.aborted) {
        rejectAborted();
        return;
      }
      job.controller.signal.addEventListener("abort", rejectAborted, {
        once: true,
      });
      removeAbortListener = () =>
        job.controller.signal.removeEventListener("abort", rejectAborted);
    });

    Promise.race([runPromise, abortPromise])
      .then(
        (value) => {
          job.state = "settling";
          for (const lease of [...job.leases.values()]) {
            job.leases.delete(lease.operationId);
            lease.resolve(value);
            terminalLease(lease);
          }
        },
        (error: unknown) => {
          job.state = "settling";
          for (const lease of [...job.leases.values()]) {
            job.leases.delete(lease.operationId);
            lease.reject(error);
            terminalLease(lease);
          }
        }
      )
      .finally(() => {
        removeAbortListener();
        if (!runSettled && job.controller.signal.aborted) {
          trackDetachedOperation(job, runPromise);
        }
        finishJob(job);
      });
    // Promise.race 已决定请求生命周期；吞掉取消后底层迟到的拒绝，防止
    // 不支持取消的系统调用制造 unhandled rejection。
    runPromise.catch(() => undefined);
  }

  function dispatch(): void {
    while (true) {
      const job = queueState.takeNext(
        (candidate) =>
          !detachedAdmissionBlocked(candidate.key) &&
          hasDetachedCapacityFor(candidate)
      );
      if (job === undefined) {
        return;
      }
      startJob(job);
    }
  }

  function schedule<T>(
    request: GitReviewScheduleRequest<T>
  ): GitReviewOperationLease<T> {
    if (activeLeases.has(request.operationId)) {
      return rejectRequest(
        request,
        new GitReviewSchedulerError(
          "duplicate-operation",
          `Duplicate Git Review operation ${request.operationId}`
        )
      );
    }
    if (request.budget.signal.aborted) {
      const reason = request.budget.failureReason() ?? "timeout";
      return rejectRequest(
        request,
        new GitReviewSchedulerError(reason, `Git Review operation ${reason}`)
      );
    }
    const keyString = gitReviewScheduleKeyToString(request.key);
    const existing = jobsByKey.get(keyString);
    if (
      existing !== undefined &&
      (existing.state === "queued" || existing.state === "running") &&
      !existing.controller.signal.aborted
    ) {
      if (activeLeases.capacityReached(request.owner, existing)) {
        return rejectRequest(
          request,
          new GitReviewSchedulerError(
            "busy",
            "Git Review lease capacity reached"
          )
        );
      }
      const attached = attachLease(
        existing,
        request as GitReviewScheduleRequest<unknown>
      );
      if (attached instanceof GitReviewSchedulerError) {
        return rejectRequest(request, attached);
      }
      return {
        promise: attached.promise as Promise<T>,
      };
    }
    if (activeLeases.capacityReached(request.owner)) {
      return rejectRequest(
        request,
        new GitReviewSchedulerError("busy", "Git Review lease capacity reached")
      );
    }
    if (
      queueState.pendingJobs >= GIT_REVIEW_SCHEDULER_GLOBAL_PENDING ||
      queueState.repositoryPending(request.key.repositoryKey) >=
        GIT_REVIEW_SCHEDULER_REPOSITORY_PENDING
    ) {
      return rejectRequest(
        request,
        new GitReviewSchedulerError("busy", "Git Review scheduler is busy")
      );
    }

    const job: GitReviewSharedJob = {
      controller: new AbortController(),
      key: request.key,
      keyString,
      leases: new Map(),
      run: request.run,
      state: "queued",
    };
    jobsByKey.set(keyString, job);
    queueState.enqueue(job);
    const attached = attachLease(
      job,
      request as GitReviewScheduleRequest<unknown>
    );
    if (attached instanceof GitReviewSchedulerError) {
      removeQueuedJob(job);
      return rejectRequest(request, attached);
    }
    dispatch();
    return {
      promise: attached.promise as Promise<T>,
    };
  }

  return {
    cancelOwned(operationId, owner, reason = "caller") {
      const record = activeLeases.get(operationId);
      if (
        record !== undefined &&
        gitReviewOwnerToString(record.lease.owner) ===
          gitReviewOwnerToString(owner)
      ) {
        cancelLease(operationId, reason);
      }
    },
    releaseOwner(owner, reason = "owner-disposed") {
      const ownerKey = gitReviewOwnerToString(owner);
      for (const operationId of activeLeases.operationsForOwner(ownerKey)) {
        cancelLease(operationId, reason);
      }
    },
    schedule,
  };
}

function cancellationReason(reason: unknown): GitReviewCancellationReason {
  if (
    reason === "caller" ||
    reason === "output-limit" ||
    reason === "owner-disposed" ||
    reason === "shutdown" ||
    reason === "timeout"
  ) {
    return reason;
  }
  return "caller";
}

function incrementCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function decrementCounter(counter: Map<string, number>, key: string): void {
  const next = (counter.get(key) ?? 1) - 1;
  if (next <= 0) {
    counter.delete(key);
    return;
  }
  counter.set(key, next);
}
