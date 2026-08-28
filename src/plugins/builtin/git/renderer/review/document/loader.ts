import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { ReviewDocumentDemand } from "./demand.ts";
import {
  assertGitReviewRetentionLimits,
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  type GitReviewRetentionLimits,
} from "./limits.ts";
import {
  cancelObsoleteLoaderBatchLoads,
  pumpLoaderExcerptBatch,
} from "./loader-batch.ts";
import {
  DEFAULT_MAX_CONCURRENT_DOCUMENTS,
  type GitReviewDocumentLoaderOptions,
} from "./loader-options.ts";
import {
  bindLoaderRuntimeField,
  cancelLoaderOperation,
  cancelObsoleteLoaderLoads,
  detachLoaderInFlightEntry,
  emitLoaderChange,
  failLoaderHydrateTimeout,
  type GitReviewDocumentLoaderRuntime,
  loaderIsSettled,
  loaderRequiredEntryKeys,
  pumpLoaderLoads,
  rebuildLoaderWaiting,
  releaseLoaderRetainedEntries,
  retainLoaderDocument,
  retryLoaderRetryableFailures,
  yieldLoaderConcurrencyForSelected,
} from "./loader-runtime.ts";
import {
  collectHydrateCandidates,
  sameEntries,
  validateReviewDocumentDemand,
} from "./loader-utils.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./resource.ts";
import { GitReviewDocumentRetention } from "./retention.ts";

type Listener = (change: GitReviewDocumentLoaderChange) => void;

export class GitReviewDocumentLoader {
  readonly #cancel: GitReviewDocumentLoaderOptions["cancel"];
  readonly #createOperationId: () => string;
  readonly #activeEntryKeys = new Set<string>();
  readonly #entryOrder: readonly string[];
  readonly #listeners = new Set<Listener>();
  readonly #load: GitReviewDocumentLoaderOptions["load"];
  readonly #loadBatch: GitReviewDocumentLoaderOptions["loadBatch"];
  readonly #maxConcurrent: number;
  readonly #resources = new Map<string, GitReviewDocumentResource>();
  readonly #retention: GitReviewDocumentRetention;
  readonly #waiting: string[] = [];
  readonly #budgetDeferredEntryKeys = new Set<string>();
  readonly #changedEntryKeys = new Set<string>();
  readonly #operationActiveCount = new Map<string, number>();
  readonly #batchOperationIds = new Set<string>();
  readonly #preFreedOperationIds = new Set<string>();
  readonly #silentRetryCount = new Map<string, number>();
  #activeCount = 0;
  #bufferedEntryKeys: readonly string[] = [];
  #disposed = false;
  #retentionLimits: GitReviewRetentionLimits;
  #selectedDemandedEntryKey: string | null = null;
  #selectedEntryKey: string | null = null;
  #stickyMemberEntryKeys: readonly string[] = [];
  #visibleEntryKeys: readonly string[] = [];

  constructor(options: GitReviewDocumentLoaderOptions) {
    const maxConcurrent =
      options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_DOCUMENTS;
    const maxRetainedBytes =
      options.maxRetainedBytes ?? GIT_REVIEW_MAX_RETAINED_BYTES;
    const maxRetainedLines =
      options.maxRetainedLines ?? GIT_REVIEW_MAX_RETAINED_LINES;
    if (!(Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0)) {
      throw new Error("git Review document 并发数必须是正安全整数");
    }
    assertGitReviewRetentionLimits({
      maxRetainedBytes,
      maxRetainedLines,
    });
    this.#cancel = options.cancel;
    this.#createOperationId =
      options.createOperationId ?? (() => crypto.randomUUID());
    this.#load = options.load;
    this.#loadBatch = options.loadBatch;
    this.#maxConcurrent = maxConcurrent;
    this.#retentionLimits = { maxRetainedBytes, maxRetainedLines };
    this.#retention = new GitReviewDocumentRetention(this.#retentionLimits);
    this.#entryOrder = options.entries.map((entry) => entry.entryKey);
    for (const entry of options.entries) {
      if (this.#resources.has(entry.entryKey)) {
        throw new Error(`git Review entryKey 重复: ${entry.entryKey}`);
      }
      this.#resources.set(entry.entryKey, { entry, kind: "idle" });
    }
  }

  getSnapshot = (): GitReviewDocumentLoaderSnapshot =>
    this.#disposed
      ? { resources: [], retainedEntryKeys: [], settled: true }
      : this.#createSnapshot();

  getRetainedEntryKeys = (): readonly string[] =>
    this.#retention.retainedEntryKeys();

  getResource(entryKey: string): GitReviewDocumentResource | undefined {
    return this.#disposed ? undefined : this.#resources.get(entryKey);
  }

  isSettled(): boolean {
    return this.#disposed || this.#isSettled();
  }

  hydrateLoaded(
    loaded: ReadonlyMap<
      string,
      Extract<GitReviewDocumentResource, { kind: "loaded" }>
    >
  ): void {
    if (this.#disposed || loaded.size === 0) {
      return;
    }
    for (const candidate of collectHydrateCandidates(this.#resources, loaded)) {
      this.#retainDocument(
        candidate.entryKey,
        candidate.entry,
        candidate.document
      );
    }
    this.#emit();
  }
  retry(entryKey: string): void {
    if (this.#disposed) {
      return;
    }
    const resource = this.#resources.get(entryKey);
    if (!resource) {
      throw new Error(`git Review 重试条目不存在: ${entryKey}`);
    }
    if (resource.kind !== "error" || !resource.failure.retryable) {
      return;
    }
    this.#silentRetryCount.delete(entryKey);
    this.#setResource(entryKey, { entry: resource.entry, kind: "idle" });
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
  }

  retryRetryableFailures(): void {
    retryLoaderRetryableFailures(this.#asRuntime());
  }

  failHydrateTimeout(entryKeys: readonly string[]): boolean {
    return failLoaderHydrateTimeout(this.#asRuntime(), entryKeys);
  }

  setProtectedEntryKey(
    entryKey: string | null,
    options?: { readonly retryLoading?: boolean }
  ): void {
    if (this.#disposed) {
      return;
    }
    const protectedEntryKey =
      entryKey !== null && this.#resources.has(entryKey) ? entryKey : null;
    const rearmed = this.#rearmRetryableError(protectedEntryKey);
    const rearmedLoading =
      options?.retryLoading === true
        ? this.#rearmLoading(protectedEntryKey)
        : false;
    if (
      this.#selectedEntryKey === protectedEntryKey &&
      this.#selectedDemandedEntryKey === protectedEntryKey &&
      !rearmed &&
      !rearmedLoading
    ) {
      return;
    }
    this.#selectedEntryKey = protectedEntryKey;
    // 选中即 demand：否则冷开/树点选在 window 尚未回报时永远不进 waiting，
    // 骨架屏会一直停到用户碰巧滚到 window 覆盖。
    this.#selectedDemandedEntryKey = protectedEntryKey;
    if (this.#selectedDemandedEntryKey !== null) {
      this.#budgetDeferredEntryKeys.delete(this.#selectedDemandedEntryKey);
    }
    this.#cancelObsoleteLoads(this.#requiredEntryKeys());
    this.#yieldConcurrencyForSelected();
    const evicted = this.#syncPinnedEntries();
    this.#releaseRetainedEntries(evicted);
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
  }

  #rearmRetryableError(entryKey: string | null): boolean {
    if (entryKey === null) {
      return false;
    }
    const resource = this.#resources.get(entryKey);
    if (resource?.kind !== "error" || !resource.failure.retryable) {
      return false;
    }
    this.#silentRetryCount.delete(entryKey);
    this.#setResource(entryKey, { entry: resource.entry, kind: "idle" });
    return true;
  }

  #rearmLoading(entryKey: string | null): boolean {
    if (entryKey === null) {
      return false;
    }
    const resource = this.#resources.get(entryKey);
    if (resource?.kind !== "loading" && resource?.kind !== "cancelling") {
      return false;
    }
    detachLoaderInFlightEntry(this.#asRuntime(), entryKey);
    this.#silentRetryCount.delete(entryKey);
    this.#setResource(entryKey, { entry: resource.entry, kind: "idle" });
    return true;
  }

  setStickyMemberEntryKeys(entryKeys: readonly string[]): void {
    if (this.#disposed) {
      return;
    }
    if (sameEntries(this.#stickyMemberEntryKeys, entryKeys)) {
      return;
    }
    this.#stickyMemberEntryKeys = [...entryKeys];
    const evicted = this.#syncPinnedEntries();
    this.#releaseRetainedEntries(evicted);
    this.#rebuildWaiting();
    const pumped = this.#pump(false);
    if (evicted.length > 0 || pumped || this.#changedEntryKeys.size > 0) {
      this.#emit();
    }
  }

  setRetentionLimits(limits: GitReviewRetentionLimits): void {
    if (this.#disposed) {
      return;
    }
    assertGitReviewRetentionLimits(limits);
    if (
      limits.maxRetainedBytes === this.#retentionLimits.maxRetainedBytes &&
      limits.maxRetainedLines === this.#retentionLimits.maxRetainedLines
    ) {
      return;
    }
    this.#retentionLimits = limits;
    this.#budgetDeferredEntryKeys.clear();
    this.#releaseRetainedEntries(this.#retention.setLimits(limits));
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
  }

  setWindowDemand(demand: ReviewDocumentDemand): void {
    if (this.#disposed) {
      return;
    }
    const visibleEntryKeys = validateReviewDocumentDemand(
      demand.visibleEntryKeys,
      "可见",
      (entryKey) => this.#resources.has(entryKey)
    );
    const visible = new Set(visibleEntryKeys);
    const bufferedEntryKeys = validateReviewDocumentDemand(
      demand.bufferedEntryKeys,
      "缓冲",
      (entryKey) => this.#resources.has(entryKey)
    ).filter((entryKey) => !visible.has(entryKey));
    if (
      sameEntries(this.#visibleEntryKeys, visibleEntryKeys) &&
      sameEntries(this.#bufferedEntryKeys, bufferedEntryKeys)
    ) {
      return;
    }
    this.#visibleEntryKeys = visibleEntryKeys;
    this.#bufferedEntryKeys = bufferedEntryKeys;
    const demanded = new Set([...visibleEntryKeys, ...bufferedEntryKeys]);
    for (const entryKey of this.#budgetDeferredEntryKeys) {
      if (!demanded.has(entryKey) || visible.has(entryKey)) {
        this.#budgetDeferredEntryKeys.delete(entryKey);
      }
    }
    if (
      this.#selectedEntryKey !== null &&
      [...visibleEntryKeys, ...bufferedEntryKeys].includes(
        this.#selectedEntryKey
      )
    ) {
      this.#selectedDemandedEntryKey = this.#selectedEntryKey;
      this.#budgetDeferredEntryKeys.delete(this.#selectedEntryKey);
    }
    this.#cancelObsoleteLoads(this.#requiredEntryKeys());
    this.#yieldConcurrencyForSelected();
    this.#releaseRetainedEntries(this.#syncPinnedEntries());
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const operationIds = new Set<string>();
    for (const entryKey of this.#activeEntryKeys) {
      const resource = this.#resources.get(entryKey);
      if (resource?.kind === "loading" || resource?.kind === "cancelling") {
        operationIds.add(resource.operationId);
      }
    }
    this.#waiting.length = 0;
    this.#activeCount = 0;
    this.#activeEntryKeys.clear();
    this.#budgetDeferredEntryKeys.clear();
    this.#changedEntryKeys.clear();
    this.#silentRetryCount.clear();
    this.#batchOperationIds.clear();
    this.#operationActiveCount.clear();
    this.#resources.clear();
    this.#retention.clear();
    this.#listeners.clear();
    for (const operationId of operationIds) {
      this.#cancelOperation(operationId);
    }
  }

  #createSnapshot(): GitReviewDocumentLoaderSnapshot {
    const resources = this.#entryOrder.map((entryKey) => {
      const resource = this.#resources.get(entryKey);
      if (!resource) {
        throw new Error(`git Review document 资源缺失: ${entryKey}`);
      }
      return resource;
    });
    return Object.freeze({
      retainedEntryKeys: Object.freeze([
        ...this.#retention.retainedEntryKeys(),
      ]),
      resources: Object.freeze(resources),
      settled: this.#isSettled(),
    });
  }

  #cancelObsoleteLoads(requiredEntryKeys: ReadonlySet<string>): void {
    const runtime = this.#asRuntime();
    if (this.#loadBatch === undefined) {
      cancelObsoleteLoaderLoads(runtime, requiredEntryKeys);
      return;
    }
    cancelObsoleteLoaderBatchLoads(runtime, requiredEntryKeys);
  }

  #yieldConcurrencyForSelected(): void {
    yieldLoaderConcurrencyForSelected(this.#asRuntime());
  }

  #cancelOperation(operationId: string): void {
    cancelLoaderOperation(this.#asRuntime(), operationId);
  }

  #emit(): void {
    emitLoaderChange(this.#asRuntime());
  }

  #pump(emitChange = true): boolean {
    if (this.#loadBatch !== undefined) {
      return pumpLoaderExcerptBatch(this.#asRuntime(), emitChange);
    }
    return pumpLoaderLoads(this.#asRuntime(), emitChange);
  }

  #rebuildWaiting(): void {
    rebuildLoaderWaiting(this.#asRuntime());
  }

  #releaseRetainedEntries(entryKeys: readonly string[]): void {
    releaseLoaderRetainedEntries(this.#asRuntime(), entryKeys);
  }

  #retainDocument(
    entryKey: string,
    entry: GitReviewIndexEntry,
    document: GitReviewFileDocumentOk
  ): void {
    retainLoaderDocument(this.#asRuntime(), entryKey, entry, document);
  }

  #requiredEntryKeys(): Set<string> {
    return loaderRequiredEntryKeys(this.#asRuntime());
  }

  #syncPinnedEntries(): string[] {
    return this.#retention.setPinnedEntryKeys(
      new Set([
        ...(this.#selectedEntryKey === null ? [] : [this.#selectedEntryKey]),
        ...this.#visibleEntryKeys,
        ...this.#stickyMemberEntryKeys,
      ])
    );
  }

  #isSettled(): boolean {
    return loaderIsSettled(this.#asRuntime());
  }

  #setResource(entryKey: string, resource: GitReviewDocumentResource): void {
    this.#resources.set(entryKey, resource);
    this.#changedEntryKeys.add(entryKey);
  }

  #asRuntime(): GitReviewDocumentLoaderRuntime {
    return {
      activeCount: bindLoaderRuntimeField(
        () => this.#activeCount,
        (next) => {
          this.#activeCount = next;
        }
      ),
      activeEntryKeys: this.#activeEntryKeys,
      budgetDeferredEntryKeys: this.#budgetDeferredEntryKeys,
      bufferedEntryKeys: bindLoaderRuntimeField(
        () => this.#bufferedEntryKeys,
        (next) => {
          this.#bufferedEntryKeys = next;
        }
      ),
      cancel: (operationId) => this.#cancel(operationId),
      changedEntryKeys: this.#changedEntryKeys,
      createOperationId: () => this.#createOperationId(),
      disposed: bindLoaderRuntimeField(
        () => this.#disposed,
        (next) => {
          this.#disposed = next;
        }
      ),
      listeners: this.#listeners,
      load: (entry, operationId) => this.#load(entry, operationId),
      ...(this.#loadBatch === undefined ? {} : { loadBatch: this.#loadBatch }),
      batchOperationIds: this.#batchOperationIds,
      maxConcurrent: this.#maxConcurrent,
      operationActiveCount: this.#operationActiveCount,
      preFreedOperationIds: this.#preFreedOperationIds,
      pumpLoads: (emitChange) => this.#pump(emitChange),
      resources: this.#resources,
      retention: this.#retention,
      selectedDemandedEntryKey: bindLoaderRuntimeField(
        () => this.#selectedDemandedEntryKey,
        (next) => {
          this.#selectedDemandedEntryKey = next;
        }
      ),
      silentRetryCount: this.#silentRetryCount,
      visibleEntryKeys: bindLoaderRuntimeField(
        () => this.#visibleEntryKeys,
        (next) => {
          this.#visibleEntryKeys = next;
        }
      ),
      waiting: this.#waiting,
      isSettled: () => this.#isSettled(),
      setResource: (entryKey, resource) =>
        this.#setResource(entryKey, resource),
    };
  }
}
