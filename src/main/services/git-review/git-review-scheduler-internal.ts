import type { GitReviewBudget } from "./git-review-budget.ts";
import type { GitReviewSharedExecutionBudget } from "./git-review-execution-budget.ts";
import type {
  GitReviewExecutionBudget,
  GitReviewOperationOwner,
  GitReviewScheduleKey,
} from "./git-review-scheduler-contract.ts";
import {
  GIT_REVIEW_SCHEDULER_GLOBAL_LEASES,
  GIT_REVIEW_SCHEDULER_GLOBAL_RUNNING,
  GIT_REVIEW_SCHEDULER_JOB_LEASES,
  GIT_REVIEW_SCHEDULER_OWNER_LEASES,
  GIT_REVIEW_SCHEDULER_REPOSITORY_RUNNING,
} from "./git-review-scheduler-policy.ts";

export interface GitReviewDeferredLease {
  abortListener: () => void;
  budget: GitReviewBudget;
  operationId: string;
  owner: GitReviewOperationOwner;
  promise: Promise<unknown>;
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  terminal: boolean;
}

export interface GitReviewSharedJob {
  controller: AbortController;
  executionBudget?: GitReviewSharedExecutionBudget;
  key: GitReviewScheduleKey;
  keyString: string;
  leases: Map<string, GitReviewDeferredLease>;
  run: (context: {
    budget: GitReviewExecutionBudget;
    signal: AbortSignal;
  }) => Promise<unknown>;
  runPromise?: Promise<unknown>;
  state: "queued" | "running" | "settling" | "settled";
}

interface ActiveLeaseRecord {
  job: GitReviewSharedJob;
  lease: GitReviewDeferredLease;
}

export class GitReviewActiveLeaseRegistry {
  readonly #active = new Map<string, ActiveLeaseRecord>();
  readonly #byOwner = new Map<string, Set<string>>();

  add(job: GitReviewSharedJob, lease: GitReviewDeferredLease): void {
    this.#active.set(lease.operationId, { job, lease });
    const ownerKey = gitReviewOwnerToString(lease.owner);
    const operations = this.#byOwner.get(ownerKey) ?? new Set<string>();
    operations.add(lease.operationId);
    this.#byOwner.set(ownerKey, operations);
  }

  capacityReached(
    owner: GitReviewOperationOwner,
    job?: GitReviewSharedJob
  ): boolean {
    return (
      this.#active.size >= GIT_REVIEW_SCHEDULER_GLOBAL_LEASES ||
      (this.#byOwner.get(gitReviewOwnerToString(owner))?.size ?? 0) >=
        GIT_REVIEW_SCHEDULER_OWNER_LEASES ||
      (job?.leases.size ?? 0) >= GIT_REVIEW_SCHEDULER_JOB_LEASES
    );
  }

  delete(lease: GitReviewDeferredLease): void {
    this.#active.delete(lease.operationId);
    const ownerKey = gitReviewOwnerToString(lease.owner);
    const operations = this.#byOwner.get(ownerKey);
    operations?.delete(lease.operationId);
    if (operations?.size === 0) {
      this.#byOwner.delete(ownerKey);
    }
  }

  get(operationId: string): ActiveLeaseRecord | undefined {
    return this.#active.get(operationId);
  }

  has(operationId: string): boolean {
    return this.#active.has(operationId);
  }

  operationsForOwner(ownerKey: string): string[] {
    return [...(this.#byOwner.get(ownerKey) ?? [])];
  }
}

export function createDeferredLease(options: {
  budget: GitReviewBudget;
  operationId: string;
  owner: GitReviewOperationOwner;
}): GitReviewDeferredLease {
  let resolvePromise: (value: unknown) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    abortListener: () => undefined,
    ...options,
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
    terminal: false,
  };
}

export function canRunGitReviewJob(job: GitReviewSharedJob): boolean {
  return (
    job.state === "running" &&
    job.leases.size > 0 &&
    !job.controller.signal.aborted
  );
}

export function gitReviewScheduleKeyToString(
  key: GitReviewScheduleKey
): string {
  return JSON.stringify([
    key.repositoryKey,
    key.operationKind,
    key.sourceKey,
    key.canonicalRequestKey,
  ]);
}

export function gitReviewOwnerToString(owner: GitReviewOperationOwner): string {
  return JSON.stringify([
    owner.clientId,
    owner.windowRecordId,
    owner.generation,
  ]);
}

export class GitReviewSchedulerQueue {
  readonly #pendingByRepository = new Map<string, GitReviewSharedJob[]>();
  readonly #runningByRepository = new Map<string, number>();
  readonly #runningBySource = new Map<string, number>();
  #lastDispatchedRepository: string | null = null;
  #pendingJobs = 0;
  #runningJobs = 0;

  get pendingJobs(): number {
    return this.#pendingJobs;
  }

  get runningJobs(): number {
    return this.#runningJobs;
  }

  enqueue(job: GitReviewSharedJob): void {
    const queue = this.#pendingByRepository.get(job.key.repositoryKey) ?? [];
    queue.push(job);
    this.#pendingByRepository.set(job.key.repositoryKey, queue);
    this.#pendingJobs += 1;
  }

  finish(job: GitReviewSharedJob): void {
    this.#runningJobs -= 1;
    decrementCounter(this.#runningByRepository, job.key.repositoryKey);
    decrementCounter(this.#runningBySource, gitReviewSourcePermitKey(job.key));
  }

  removeQueued(job: GitReviewSharedJob): boolean {
    const queue = this.#pendingByRepository.get(job.key.repositoryKey);
    const index = queue?.indexOf(job) ?? -1;
    if (queue === undefined || index < 0) {
      return false;
    }
    queue.splice(index, 1);
    this.#pendingJobs -= 1;
    if (queue.length === 0) {
      this.#pendingByRepository.delete(job.key.repositoryKey);
    }
    return true;
  }

  repositoryPending(repositoryKey: string): number {
    return this.#pendingByRepository.get(repositoryKey)?.length ?? 0;
  }

  repositoryRunning(repositoryKey: string): number {
    return this.#runningByRepository.get(repositoryKey) ?? 0;
  }

  start(job: GitReviewSharedJob): void {
    this.#runningJobs += 1;
    incrementCounter(this.#runningByRepository, job.key.repositoryKey);
    incrementCounter(this.#runningBySource, gitReviewSourcePermitKey(job.key));
  }

  takeNext(
    additionalPermit: (job: GitReviewSharedJob) => boolean = () => true
  ): GitReviewSharedJob | undefined {
    const repositories = [...this.#pendingByRepository.keys()];
    if (repositories.length === 0) {
      return;
    }
    const previousIndex =
      this.#lastDispatchedRepository === null
        ? -1
        : repositories.indexOf(this.#lastDispatchedRepository);
    for (let offset = 1; offset <= repositories.length; offset += 1) {
      const index =
        (Math.max(previousIndex, -1) + offset) % repositories.length;
      const repository = repositories[index];
      if (repository === undefined) {
        continue;
      }
      const queue = this.#pendingByRepository.get(repository);
      const job = queue?.find(
        (candidate) => this.#hasPermit(candidate) && additionalPermit(candidate)
      );
      if (job === undefined) {
        continue;
      }
      this.removeQueued(job);
      this.#lastDispatchedRepository = repository;
      return job;
    }
    return;
  }

  #hasPermit(job: GitReviewSharedJob): boolean {
    return (
      this.#runningJobs < GIT_REVIEW_SCHEDULER_GLOBAL_RUNNING &&
      (this.#runningByRepository.get(job.key.repositoryKey) ?? 0) <
        GIT_REVIEW_SCHEDULER_REPOSITORY_RUNNING &&
      (this.#runningBySource.get(gitReviewSourcePermitKey(job.key)) ?? 0) < 1
    );
  }
}

export function gitReviewSourcePermitKey(key: GitReviewScheduleKey): string {
  return JSON.stringify([key.repositoryKey, key.sourceKey]);
}

function incrementCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function decrementCounter(counter: Map<string, number>, key: string): void {
  const next = (counter.get(key) ?? 1) - 1;
  if (next === 0) {
    counter.delete(key);
  } else {
    counter.set(key, next);
  }
}
