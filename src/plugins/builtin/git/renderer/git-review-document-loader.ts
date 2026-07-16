import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import type { ReviewDocumentDemand } from "./git-review-document-demand.ts";
import {
  assertGitReviewRetentionLimits,
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  type GitReviewRetentionLimits,
} from "./git-review-document-limits.ts";
import {
  documentMatchesSlots,
  sameEntries,
  validateReviewDocumentDemand,
} from "./git-review-document-loader-utils.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import { GitReviewDocumentRetention } from "./git-review-document-retention.ts";

interface GitReviewDocumentLoaderOptions {
  readonly cancel: (operationId: string) => Promise<void>;
  readonly createOperationId?: () => string;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly load: (
    entry: GitReviewIndexEntry,
    operationId: string
  ) => Promise<GitReviewFileDocumentResult>;
  readonly maxConcurrent?: number;
  readonly maxRetainedBytes?: number;
  readonly maxRetainedLines?: number;
}

type Listener = (change: GitReviewDocumentLoaderChange) => void;
const DEFAULT_MAX_CONCURRENT_DOCUMENTS = 2;

export class GitReviewDocumentLoader {
  readonly #cancel: GitReviewDocumentLoaderOptions["cancel"];
  readonly #createOperationId: () => string;
  readonly #activeEntryKeys = new Set<string>();
  readonly #entryOrder: readonly string[];
  readonly #listeners = new Set<Listener>();
  readonly #load: GitReviewDocumentLoaderOptions["load"];
  readonly #maxConcurrent: number;
  readonly #resources = new Map<string, GitReviewDocumentResource>();
  readonly #retention: GitReviewDocumentRetention;
  readonly #waiting: string[] = [];
  readonly #budgetDeferredEntryKeys = new Set<string>();
  readonly #changedEntryKeys = new Set<string>();
  #activeCount = 0;
  #bufferedEntryKeys: readonly string[] = [];
  #disposed = false;
  #retentionLimits: GitReviewRetentionLimits;
  #selectedDemandedEntryKey: string | null = null;
  #selectedEntryKey: string | null = null;
  #visibleEntryKeys: readonly string[] = [];

  constructor(options: GitReviewDocumentLoaderOptions) {
    const maxConcurrent =
      options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_DOCUMENTS;
    const maxRetainedBytes =
      options.maxRetainedBytes ?? GIT_REVIEW_MAX_RETAINED_BYTES;
    const maxRetainedLines =
      options.maxRetainedLines ?? GIT_REVIEW_MAX_RETAINED_LINES;
    if (!(Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0)) {
      throw new Error("Git Review document 并发数必须是正安全整数");
    }
    assertGitReviewRetentionLimits({
      maxRetainedBytes,
      maxRetainedLines,
    });
    this.#cancel = options.cancel;
    this.#createOperationId =
      options.createOperationId ?? (() => crypto.randomUUID());
    this.#load = options.load;
    this.#maxConcurrent = maxConcurrent;
    this.#retentionLimits = { maxRetainedBytes, maxRetainedLines };
    this.#retention = new GitReviewDocumentRetention(this.#retentionLimits);
    this.#entryOrder = options.entries.map((entry) => entry.entryKey);
    for (const entry of options.entries) {
      if (this.#resources.has(entry.entryKey)) {
        throw new Error(`Git Review entryKey 重复: ${entry.entryKey}`);
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

  retry(entryKey: string): void {
    if (this.#disposed) {
      return;
    }
    const resource = this.#resources.get(entryKey);
    if (!resource) {
      throw new Error(`Git Review 重试条目不存在: ${entryKey}`);
    }
    if (resource.kind !== "error" || !resource.failure.retryable) {
      return;
    }
    this.#setResource(entryKey, { entry: resource.entry, kind: "idle" });
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
  }

  setProtectedEntryKey(entryKey: string | null): void {
    if (this.#disposed) {
      return;
    }
    if (entryKey !== null && !this.#resources.has(entryKey)) {
      throw new Error(`Git Review 保护目标不存在: ${entryKey}`);
    }
    if (this.#selectedEntryKey === entryKey) {
      return;
    }
    this.#selectedEntryKey = entryKey;
    this.#selectedDemandedEntryKey =
      entryKey !== null &&
      [...this.#visibleEntryKeys, ...this.#bufferedEntryKeys].includes(entryKey)
        ? entryKey
        : null;
    if (this.#selectedDemandedEntryKey !== null) {
      this.#budgetDeferredEntryKeys.delete(this.#selectedDemandedEntryKey);
    }
    this.#cancelObsoleteLoads(this.#requiredEntryKeys());
    const evicted = this.#syncPinnedEntries();
    this.#releaseRetainedEntries(evicted);
    this.#rebuildWaiting();
    this.#pump(false);
    this.#emit();
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
    const operationIds = [...this.#activeEntryKeys].flatMap((entryKey) => {
      const resource = this.#resources.get(entryKey);
      return resource?.kind === "loading" || resource?.kind === "cancelling"
        ? [resource.operationId]
        : [];
    });
    this.#waiting.length = 0;
    this.#activeCount = 0;
    this.#activeEntryKeys.clear();
    this.#budgetDeferredEntryKeys.clear();
    this.#changedEntryKeys.clear();
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
        throw new Error(`Git Review document 资源缺失: ${entryKey}`);
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
    for (const entryKey of this.#activeEntryKeys) {
      const resource = this.#resources.get(entryKey);
      if (resource?.kind !== "loading" || requiredEntryKeys.has(entryKey)) {
        continue;
      }
      this.#setResource(entryKey, {
        entry: resource.entry,
        kind: "cancelling",
        operationId: resource.operationId,
      });
      this.#cancelOperation(resource.operationId);
    }
  }

  #cancelOperation(operationId: string): void {
    try {
      this.#cancel(operationId).catch(() => undefined);
    } catch {
      // 取消是尽力而为；operationId 围栏仍会拒绝迟到结果。
    }
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }
    const resources = [...this.#changedEntryKeys].flatMap((entryKey) => {
      const resource = this.#resources.get(entryKey);
      return resource === undefined ? [] : [resource];
    });
    this.#changedEntryKeys.clear();
    const change = Object.freeze({
      resources: Object.freeze(resources),
      settled: this.#isSettled(),
    });
    for (const listener of this.#listeners) {
      listener(change);
    }
  }

  #pump(emitChange = true): boolean {
    if (this.#disposed) {
      return false;
    }
    let changed = false;
    while (
      this.#activeCount < this.#maxConcurrent &&
      this.#waiting.length > 0
    ) {
      const entryKey = this.#waiting.shift();
      if (entryKey === undefined) {
        break;
      }
      const resource = this.#resources.get(entryKey);
      if (resource?.kind !== "idle") {
        continue;
      }
      const operationId = this.#createOperationId();
      this.#setResource(entryKey, {
        entry: resource.entry,
        kind: "loading",
        operationId,
      });
      this.#activeCount += 1;
      this.#activeEntryKeys.add(entryKey);
      changed = true;
      let pending: Promise<GitReviewFileDocumentResult>;
      try {
        pending = this.#load(resource.entry, operationId);
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
        (result) => this.#settle(entryKey, operationId, result),
        (error: unknown) =>
          this.#settle(entryKey, operationId, {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
            reason: "internal",
            retryable: true,
          })
      );
    }
    if (changed && emitChange) {
      this.#emit();
    }
    return changed;
  }

  #rebuildWaiting(): void {
    this.#waiting.length = 0;
    const seen = new Set<string>();
    for (const entryKey of [
      ...(this.#selectedDemandedEntryKey === null
        ? []
        : [this.#selectedDemandedEntryKey]),
      ...this.#visibleEntryKeys,
      ...this.#bufferedEntryKeys,
    ]) {
      if (seen.has(entryKey)) {
        continue;
      }
      seen.add(entryKey);
      const resource = this.#resources.get(entryKey);
      if (resource?.kind === "loaded") {
        this.#retention.touch(entryKey);
      } else if (
        resource?.kind === "idle" &&
        !this.#budgetDeferredEntryKeys.has(entryKey)
      ) {
        this.#waiting.push(entryKey);
      }
    }
  }

  #releaseRetainedEntries(entryKeys: readonly string[]): void {
    for (const entryKey of entryKeys) {
      const evicted = this.#resources.get(entryKey);
      if (evicted?.kind === "loaded") {
        this.#setResource(entryKey, {
          entry: evicted.entry,
          kind: "idle",
        });
        if (
          this.#bufferedEntryKeys.includes(entryKey) &&
          !this.#visibleEntryKeys.includes(entryKey) &&
          entryKey !== this.#selectedDemandedEntryKey
        ) {
          this.#budgetDeferredEntryKeys.add(entryKey);
        }
      }
    }
  }

  #retainDocument(
    entryKey: string,
    entry: GitReviewIndexEntry,
    document: GitReviewFileDocumentOk
  ): void {
    this.#setResource(entryKey, { document, entry, kind: "loaded" });
    this.#releaseRetainedEntries(this.#retention.retain(entryKey, document));
  }

  #requiredEntryKeys(): Set<string> {
    return new Set([
      ...(this.#selectedDemandedEntryKey === null
        ? []
        : [this.#selectedDemandedEntryKey]),
      ...this.#visibleEntryKeys,
      ...this.#bufferedEntryKeys.filter(
        (entryKey) => !this.#budgetDeferredEntryKeys.has(entryKey)
      ),
    ]);
  }

  #settle(
    entryKey: string,
    operationId: string,
    result: GitReviewFileDocumentResult
  ): void {
    if (this.#disposed) {
      return;
    }
    const resource = this.#resources.get(entryKey);
    if (
      (resource?.kind !== "loading" && resource?.kind !== "cancelling") ||
      resource.operationId !== operationId
    ) {
      return;
    }
    this.#activeEntryKeys.delete(entryKey);
    this.#activeCount -= 1;
    if (resource.kind === "cancelling") {
      this.#setResource(entryKey, { entry: resource.entry, kind: "idle" });
      this.#rebuildWaiting();
      this.#pump(false);
      this.#emit();
      return;
    }
    if (result.kind === "ok" && documentMatchesSlots(resource.entry, result)) {
      this.#retainDocument(entryKey, resource.entry, result);
    } else if (result.kind === "ok") {
      this.#setResource(entryKey, {
        entry: resource.entry,
        failure: {
          kind: "error",
          message: "Git Review document sections do not match the index slots.",
          reason: "internal",
          retryable: true,
        },
        kind: "error",
      });
    } else if (result.kind === "unchanged") {
      this.#setResource(entryKey, {
        entry: resource.entry,
        kind: "unchanged",
      });
    } else {
      this.#setResource(entryKey, {
        entry: resource.entry,
        failure: result,
        kind: "error",
      });
    }
    this.#pump(false);
    this.#emit();
  }

  #syncPinnedEntries(): string[] {
    return this.#retention.setPinnedEntryKeys(
      new Set([
        ...(this.#selectedEntryKey === null ? [] : [this.#selectedEntryKey]),
        ...this.#visibleEntryKeys,
      ])
    );
  }

  #isSettled(): boolean {
    for (const entryKey of this.#requiredEntryKeys()) {
      const resource = this.#resources.get(entryKey);
      if (
        resource?.kind === "idle" ||
        resource?.kind === "loading" ||
        resource?.kind === "cancelling"
      ) {
        return false;
      }
    }
    return true;
  }

  #setResource(entryKey: string, resource: GitReviewDocumentResource): void {
    this.#resources.set(entryKey, resource);
    this.#changedEntryKeys.add(entryKey);
  }
}
