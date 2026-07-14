import type { GitReviewBudget } from "./git-review-budget.ts";
import type { GitReviewSharedExecutionBudget } from "./git-review-execution-budget.ts";
import type { GitReviewSettleObservation } from "./git-review-observer-contract.ts";
import type {
  GitReviewExecutionBudget,
  GitReviewOperationLease,
  GitReviewOperationOwner,
  GitReviewScheduleIntent,
  GitReviewScheduleKey,
  GitReviewSchedulerError,
} from "./git-review-scheduler-contract.ts";
import {
  GIT_REVIEW_SCHEDULER_GLOBAL_LEASES,
  GIT_REVIEW_SCHEDULER_GLOBAL_RUNNING,
  GIT_REVIEW_SCHEDULER_JOB_LEASES,
  GIT_REVIEW_SCHEDULER_OWNER_LEASES,
  GIT_REVIEW_SCHEDULER_REPOSITORY_RUNNING,
  isHighPriorityGitReviewJob,
} from "./git-review-scheduler-policy.ts";

export interface GitReviewDeferredLease {
  abortListener: () => void;
  budget: GitReviewBudget;
  deduplicated: boolean;
  intent: GitReviewScheduleIntent;
  lifecycleState: "created" | "queued" | "running" | "terminal";
  observeError: (error: unknown) => GitReviewSettleObservation;
  observeResult: (value: unknown) => GitReviewSettleObservation;
  operationId: string;
  owner: GitReviewOperationOwner;
  promise: Promise<unknown>;
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  terminal: boolean;
}

export interface GitReviewTransitionDeliveryContext {
  readonly guards: readonly GitReviewTransitionDeliveryGuard[];
}

export interface GitReviewTransitionDeliveryGuard {
  acquire: () => void;
  release: () => void;
}

export interface GitReviewSharedJob {
  controller: AbortController;
  executionBudget?: GitReviewSharedExecutionBudget;
  intent: GitReviewScheduleIntent;
  key: GitReviewScheduleKey;
  keyString: string;
  laneKey: string;
  leases: Map<string, GitReviewDeferredLease>;
  queuedAtMs: number;
  run: (context: {
    budget: GitReviewExecutionBudget;
    signal: AbortSignal;
  }) => Promise<unknown>;
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

  get size(): number {
    return this.#active.size;
  }
}

export function createDeferredLease(options: {
  budget: GitReviewBudget;
  deduplicated: boolean;
  intent: GitReviewScheduleIntent;
  observeError: (error: unknown) => GitReviewSettleObservation;
  observeResult: (value: unknown) => GitReviewSettleObservation;
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
    lifecycleState: "created",
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

export class GitReviewSchedulerReservations {
  readonly #operationIds = new Set<string>();
  readonly #ownerDepths = new Map<string, number>();
  readonly #watchLaneVersions = new Map<string, number>();
  #watchSequence = 0;

  claimWatchLane(laneKey: string): number {
    this.#watchSequence += 1;
    this.#watchLaneVersions.set(laneKey, this.#watchSequence);
    return this.#watchSequence;
  }

  isOperationReserved(operationId: string): boolean {
    return this.#operationIds.has(operationId);
  }

  isOwnerReserved(ownerKey: string): boolean {
    return (this.#ownerDepths.get(ownerKey) ?? 0) > 0;
  }

  isWatchLaneCurrent(laneKey: string, version: number): boolean {
    return this.#watchLaneVersions.get(laneKey) === version;
  }

  ownerDeliveryContext(ownerKey: string): GitReviewTransitionDeliveryContext {
    return {
      guards: [
        {
          acquire: () => this.reserveOwner(ownerKey),
          release: () => this.releaseOwner(ownerKey),
        },
      ],
    };
  }

  releaseOperation(operationId: string): void {
    this.#operationIds.delete(operationId);
  }

  releaseOwner(ownerKey: string): void {
    const nextDepth = (this.#ownerDepths.get(ownerKey) ?? 1) - 1;
    if (nextDepth === 0) {
      this.#ownerDepths.delete(ownerKey);
    } else {
      this.#ownerDepths.set(ownerKey, nextDepth);
    }
  }

  releaseWatchLane(laneKey: string, version: number): void {
    if (this.isWatchLaneCurrent(laneKey, version)) {
      this.#watchLaneVersions.delete(laneKey);
    }
  }

  reserveOperation(operationId: string): void {
    this.#operationIds.add(operationId);
  }

  reserveOwner(ownerKey: string): void {
    this.#ownerDepths.set(ownerKey, (this.#ownerDepths.get(ownerKey) ?? 0) + 1);
  }
}

export function createRejectedOperationLease<T>(
  operationId: string,
  error: GitReviewSchedulerError
): GitReviewOperationLease<T> {
  const promise = Promise.reject(error);
  promise.catch(() => undefined);
  return { cancel: () => undefined, operationId, promise };
}

export function gitReviewScheduleKeyToString(
  key: GitReviewScheduleKey
): string {
  return JSON.stringify([
    key.repositoryKey,
    key.operationKind,
    key.sourceKey,
    key.canonicalRequestKey,
    key.contentRequirement,
  ]);
}

export function gitReviewWatchLaneToString(key: GitReviewScheduleKey): string {
  return JSON.stringify([key.repositoryKey, key.sourceKey, key.operationKind]);
}

export function gitReviewOwnerToString(owner: GitReviewOperationOwner): string {
  return JSON.stringify([
    owner.clientId,
    owner.windowRecordId,
    owner.generation,
  ]);
}

export class GitReviewSchedulerQueue {
  readonly #now: () => number;
  readonly #pendingByRepository = new Map<string, GitReviewSharedJob[]>();
  readonly #runningByRepository = new Map<string, number>();
  readonly #runningBySource = new Map<string, number>();
  #lastDispatchedRepository: string | null = null;
  #pendingJobs = 0;
  #runningJobs = 0;

  constructor(now: () => number) {
    this.#now = now;
  }

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
    decrementCounter(this.#runningBySource, sourcePermitKey(job));
  }

  findQueuedWatch(laneKey: string): GitReviewSharedJob | undefined {
    for (const queue of this.#pendingByRepository.values()) {
      const job = queue.find(
        (candidate) =>
          candidate.intent === "watch" &&
          candidate.laneKey === laneKey &&
          candidate.state === "queued"
      );
      if (job !== undefined) {
        return job;
      }
    }
    return;
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

  start(job: GitReviewSharedJob): void {
    this.#runningJobs += 1;
    incrementCounter(this.#runningByRepository, job.key.repositoryKey);
    incrementCounter(this.#runningBySource, sourcePermitKey(job));
  }

  takeNext(): GitReviewSharedJob | undefined {
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
      if (queue === undefined) {
        continue;
      }
      const job = this.#findCandidate(queue);
      if (job === undefined) {
        continue;
      }
      this.removeQueued(job);
      this.#lastDispatchedRepository = repository;
      return job;
    }
    return;
  }

  #findCandidate(
    queue: readonly GitReviewSharedJob[]
  ): GitReviewSharedJob | undefined {
    const eligible = queue.filter((job) => this.#hasPermit(job));
    return (
      eligible.find((job) =>
        isHighPriorityGitReviewJob(job.intent, job.queuedAtMs, this.#now())
      ) ?? eligible[0]
    );
  }

  #hasPermit(job: GitReviewSharedJob): boolean {
    return (
      this.#runningJobs < GIT_REVIEW_SCHEDULER_GLOBAL_RUNNING &&
      (this.#runningByRepository.get(job.key.repositoryKey) ?? 0) <
        GIT_REVIEW_SCHEDULER_REPOSITORY_RUNNING &&
      (this.#runningBySource.get(sourcePermitKey(job)) ?? 0) < 1
    );
  }
}

function sourcePermitKey(job: GitReviewSharedJob): string {
  return JSON.stringify([job.key.repositoryKey, job.key.sourceKey]);
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
