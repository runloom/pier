import type {
  GitReviewFileDocumentOk,
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
  DEFAULT_MAX_CONCURRENT_DOCUMENTS,
  type GitReviewDocumentLoaderOptions,
} from "./git-review-document-loader-options.ts";
import {
  cancelLoaderOperation,
  emitLoaderChange,
  type GitReviewDocumentLoaderRuntime,
  pumpLoaderLoads,
  rebuildLoaderWaiting,
  releaseLoaderRetainedEntries,
  retainLoaderDocument,
} from "./git-review-document-loader-runtime.ts";
import {
  collectHydrateCandidates,
  sameEntries,
  validateReviewDocumentDemand,
} from "./git-review-document-loader-utils.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import { GitReviewDocumentRetention } from "./git-review-document-retention.ts";

type Listener = (change: GitReviewDocumentLoaderChange) => void;

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
  /** settle 时已提前释放并发的 operationId（插队 yield）。 */
  readonly #preFreedOperationIds = new Set<string>();
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

  /**
   * 从 session 缓存灌入已 loaded 正文；仅当 entry 仍在 loader 且 slots 匹配时保留。
   * 不发网络；结束只 #emit 一次。
   */
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
    // 仅 protect 不构成 demand（无 window 时不得开读）；
    // 已在 visible/buffered 时 boost 为 selectedDemanded 队首。
    this.#selectedDemandedEntryKey =
      entryKey !== null &&
      [...this.#visibleEntryKeys, ...this.#bufferedEntryKeys].includes(entryKey)
        ? entryKey
        : null;
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

  /**
   * tree-nav 期间把 sticky CodeView 成员并入 retention pin，避免 LRU 抽空 candidates。
   * settled 后传 [] 即可。
   */
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
    // sticky 常在 sync 监听器内更新；无资源变更时勿 #emit 重入（滚动热路径双倍 sync）。
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
    // selected 在 demand 中则 boost 为队首 required
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

  #yieldConcurrencyForSelected(): void {
    const selected = this.#selectedDemandedEntryKey;
    if (selected === null) {
      return;
    }
    const resource = this.#resources.get(selected);
    if (resource?.kind !== "idle") {
      return;
    }
    if (this.#activeCount < this.#maxConcurrent) {
      return;
    }
    for (const entryKey of this.#activeEntryKeys) {
      if (entryKey === selected) {
        continue;
      }
      const active = this.#resources.get(entryKey);
      if (active?.kind !== "loading") {
        continue;
      }
      this.#setResource(entryKey, {
        entry: active.entry,
        kind: "cancelling",
        operationId: active.operationId,
      });
      this.#activeEntryKeys.delete(entryKey);
      this.#activeCount -= 1;
      this.#preFreedOperationIds.add(active.operationId);
      this.#cancelOperation(active.operationId);
      break;
    }
  }

  #cancelOperation(operationId: string): void {
    cancelLoaderOperation(this.#asRuntime(), operationId);
  }

  #emit(): void {
    emitLoaderChange(this.#asRuntime());
  }

  #pump(emitChange = true): boolean {
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

  #asRuntime(): GitReviewDocumentLoaderRuntime {
    const self = this;
    return {
      get activeCount() {
        return {
          get value() {
            return self.#activeCount;
          },
          set value(next: number) {
            self.#activeCount = next;
          },
        };
      },
      activeEntryKeys: self.#activeEntryKeys,
      budgetDeferredEntryKeys: self.#budgetDeferredEntryKeys,
      get bufferedEntryKeys() {
        return {
          get value() {
            return self.#bufferedEntryKeys;
          },
          set value(next: readonly string[]) {
            self.#bufferedEntryKeys = next;
          },
        };
      },
      cancel: (operationId) => self.#cancel(operationId),
      changedEntryKeys: self.#changedEntryKeys,
      createOperationId: () => self.#createOperationId(),
      get disposed() {
        return {
          get value() {
            return self.#disposed;
          },
          set value(next: boolean) {
            self.#disposed = next;
          },
        };
      },
      listeners: self.#listeners,
      load: (entry, operationId) => self.#load(entry, operationId),
      maxConcurrent: self.#maxConcurrent,
      preFreedOperationIds: self.#preFreedOperationIds,
      resources: self.#resources,
      retention: self.#retention,
      get selectedDemandedEntryKey() {
        return {
          get value() {
            return self.#selectedDemandedEntryKey;
          },
          set value(next: string | null) {
            self.#selectedDemandedEntryKey = next;
          },
        };
      },
      get visibleEntryKeys() {
        return {
          get value() {
            return self.#visibleEntryKeys;
          },
          set value(next: readonly string[]) {
            self.#visibleEntryKeys = next;
          },
        };
      },
      waiting: self.#waiting,
      isSettled: () => self.#isSettled(),
      setResource: (entryKey, resource) =>
        self.#setResource(entryKey, resource),
    };
  }
}
