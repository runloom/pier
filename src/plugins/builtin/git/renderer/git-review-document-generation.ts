import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  type GitReviewRetentionLimits,
  gitReviewDocumentMetrics,
  isGitReviewDocumentReservable,
} from "./git-review-document-limits.ts";
import {
  type ReviewDocumentViewState,
  reconcileReviewDocumentSnapshot,
} from "./git-review-document-projection.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";

type LoadedResource = Extract<GitReviewDocumentResource, { kind: "loaded" }>;
export type ReviewFailedResource = Extract<
  GitReviewDocumentResource,
  { kind: "error" }
>;

export interface ReviewFailureChange {
  readonly entryKey: string;
  readonly resource: ReviewFailedResource | null;
  readonly source: "document" | "refresh";
}

export interface ReviewDocumentGenerationChange {
  readonly changedResources: readonly GitReviewDocumentResource[];
  readonly failureChanges: readonly ReviewFailureChange[];
  readonly settled: boolean;
  readonly staleRetainedCount: number;
}

/**
 * 单个 index 代的增量协调器。完整资源数组只在代际建立与交接时扫描；正文
 * 结算只更新对应 entry，并以 O(1) 指标记账维护跨代软缓存预算。
 */
export class GitReviewDocumentGeneration {
  readonly #currentByEntryKey = new Map<string, GitReviewDocumentResource>();
  readonly #effectiveResources: GitReviewDocumentResource[];
  readonly #failures = new Map<string, ReviewFailedResource>();
  readonly #indexByEntryKey = new Map<string, number>();
  readonly #previousByEntryKey: Map<string, LoadedResource>;
  readonly #refreshFailures = new Map<string, ReviewFailedResource>();
  readonly #staleEntryKeys = new Set<string>();
  readonly #generation: number;
  #previousRetainedBytes = 0;
  #previousRetainedLines = 0;
  #protectedEntryKey: string | null;
  #retainedBytes = 0;
  #retainedLines = 0;
  #settled: boolean;

  constructor(options: {
    readonly current: GitReviewDocumentLoaderSnapshot;
    readonly generation: number;
    readonly previousByEntryKey: Map<string, LoadedResource>;
    readonly protectedEntryKey: string | null;
  }) {
    this.#generation = options.generation;
    this.#previousByEntryKey = options.previousByEntryKey;
    this.#protectedEntryKey = options.protectedEntryKey;
    this.#settled = options.current.settled;
    for (const [index, resource] of options.current.resources.entries()) {
      this.#currentByEntryKey.set(resource.entry.entryKey, resource);
      this.#indexByEntryKey.set(resource.entry.entryKey, index);
    }
    const initial = reconcileReviewDocumentSnapshot(
      options.current,
      this.#previousByEntryKey,
      options.generation,
      options.protectedEntryKey
    );
    this.#effectiveResources = [...initial.snapshot.resources];
    for (const resource of this.#effectiveResources) {
      this.#recordEffective(resource);
      if (resource.kind === "loaded") {
        const metrics = gitReviewDocumentMetrics(resource.document);
        this.#retainedBytes += metrics.bytes;
        this.#retainedLines += metrics.lines;
      }
    }
    for (const previous of this.#previousByEntryKey.values()) {
      const metrics = gitReviewDocumentMetrics(previous.document);
      this.#previousRetainedBytes += metrics.bytes;
      this.#previousRetainedLines += metrics.lines;
    }
    for (const resource of options.current.resources) {
      if (this.#previousByEntryKey.has(resource.entry.entryKey)) {
        if (resource.kind === "error") {
          this.#refreshFailures.set(resource.entry.entryKey, resource);
        } else if (resource.kind === "unchanged") {
          this.#staleEntryKeys.add(resource.entry.entryKey);
        }
      }
    }
  }

  apply(
    change: GitReviewDocumentLoaderChange,
    protectedEntryKey: string | null
  ): ReviewDocumentGenerationChange {
    this.#protectedEntryKey = protectedEntryKey;
    this.#settled = change.settled;
    const changed = new Map<string, GitReviewDocumentResource>();
    const affectedEntryKeys = new Set<string>();
    for (const current of change.resources) {
      const entryKey = current.entry.entryKey;
      affectedEntryKeys.add(entryKey);
      this.#currentByEntryKey.set(entryKey, current);
      if (current.kind === "loaded") {
        this.#removePrevious(entryKey);
      }
      this.#resolveEntry(entryKey, changed);
    }
    this.#enforceBudget(changed, affectedEntryKeys);
    return {
      changedResources: [...changed.values()],
      failureChanges: this.#failureChanges(affectedEntryKeys),
      settled: this.#settled,
      staleRetainedCount: this.#staleEntryKeys.size,
    };
  }

  initialFailureChanges(): readonly ReviewFailureChange[] {
    const changes: ReviewFailureChange[] = [];
    for (const resource of this.#failures.values()) {
      changes.push({
        entryKey: resource.entry.entryKey,
        resource,
        source: "document",
      });
    }
    for (const resource of this.#refreshFailures.values()) {
      changes.push({
        entryKey: resource.entry.entryKey,
        resource,
        source: "refresh",
      });
    }
    return changes;
  }

  /**
   * UI 元状态。完整资源请用 snapshot(retainedEntryKeys)。
   */
  initialViewState(): ReviewDocumentViewState {
    return {
      generation: this.#generation,
      retainedEntryKeys: [...this.#previousByEntryKey.keys()],
      settled: this.#settled,
      staleRetainedCount: this.#staleEntryKeys.size,
    };
  }

  snapshot(
    currentRetainedEntryKeys: readonly string[]
  ): GitReviewDocumentLoaderSnapshot {
    const retained = new Set<string>(this.#previousByEntryKey.keys());
    for (const entryKey of currentRetainedEntryKeys) {
      retained.add(entryKey);
    }
    return {
      resources: [...this.#effectiveResources],
      retainedEntryKeys: [...retained],
      settled: this.#settled,
    };
  }

  retentionLimits(): GitReviewRetentionLimits {
    return {
      maxRetainedBytes: Math.max(
        1,
        GIT_REVIEW_MAX_RETAINED_BYTES - this.#previousRetainedBytes
      ),
      maxRetainedLines: Math.max(
        1,
        GIT_REVIEW_MAX_RETAINED_LINES - this.#previousRetainedLines
      ),
    };
  }

  #effectiveProtectedPreviousEntryKey(): string | null {
    const resource =
      this.#protectedEntryKey === null
        ? undefined
        : this.#previousByEntryKey.get(this.#protectedEntryKey);
    return resource && isGitReviewDocumentReservable(resource.document)
      ? resource.entry.entryKey
      : null;
  }

  #enforceBudget(
    changed: Map<string, GitReviewDocumentResource>,
    affectedEntryKeys: Set<string>
  ): void {
    const protectedEntryKey = this.#effectiveProtectedPreviousEntryKey();
    while (
      this.#retainedBytes > GIT_REVIEW_MAX_RETAINED_BYTES ||
      this.#retainedLines > GIT_REVIEW_MAX_RETAINED_LINES
    ) {
      let candidate: string | null = null;
      for (const entryKey of this.#previousByEntryKey.keys()) {
        if (entryKey !== protectedEntryKey) {
          candidate = entryKey;
          break;
        }
      }
      if (candidate === null) {
        break;
      }
      this.#removePrevious(candidate);
      affectedEntryKeys.add(candidate);
      this.#resolveEntry(candidate, changed);
    }
  }

  #failureChanges(
    affectedEntryKeys: ReadonlySet<string>
  ): readonly ReviewFailureChange[] {
    const changes: ReviewFailureChange[] = [];
    for (const entryKey of affectedEntryKeys) {
      changes.push(
        {
          entryKey,
          resource: this.#failures.get(entryKey) ?? null,
          source: "document",
        },
        {
          entryKey,
          resource: this.#refreshFailures.get(entryKey) ?? null,
          source: "refresh",
        }
      );
    }
    return changes;
  }

  #removePrevious(entryKey: string): LoadedResource | undefined {
    const previous = this.#previousByEntryKey.get(entryKey);
    if (!previous) {
      return;
    }
    this.#previousByEntryKey.delete(entryKey);
    const metrics = gitReviewDocumentMetrics(previous.document);
    this.#previousRetainedBytes -= metrics.bytes;
    this.#previousRetainedLines -= metrics.lines;
    return previous;
  }

  #recordEffective(resource: GitReviewDocumentResource): void {
    const entryKey = resource.entry.entryKey;
    if (resource.kind === "error") {
      this.#failures.set(entryKey, resource);
    } else {
      this.#failures.delete(entryKey);
    }
  }

  #replaceEffective(
    entryKey: string,
    resource: GitReviewDocumentResource,
    changed: Map<string, GitReviewDocumentResource>
  ): void {
    const index = this.#indexByEntryKey.get(entryKey);
    if (index === undefined) {
      return;
    }
    const previous = this.#effectiveResources[index];
    if (previous === resource) {
      return;
    }
    if (previous?.kind === "loaded") {
      const metrics = gitReviewDocumentMetrics(previous.document);
      this.#retainedBytes -= metrics.bytes;
      this.#retainedLines -= metrics.lines;
    }
    if (resource.kind === "loaded") {
      const metrics = gitReviewDocumentMetrics(resource.document);
      this.#retainedBytes += metrics.bytes;
      this.#retainedLines += metrics.lines;
    }
    this.#effectiveResources[index] = resource;
    this.#recordEffective(resource);
    changed.set(entryKey, resource);
  }

  #resolveEntry(
    entryKey: string,
    changed: Map<string, GitReviewDocumentResource>
  ): void {
    const current = this.#currentByEntryKey.get(entryKey);
    if (!current) {
      return;
    }
    const previous = this.#previousByEntryKey.get(entryKey);
    const index = this.#indexByEntryKey.get(entryKey);
    const effective =
      index === undefined ? undefined : this.#effectiveResources[index];
    const retainedLoaded =
      previous ?? (effective?.kind === "loaded" ? effective : undefined);
    // 在新的 loaded 到达前，保留已有正文：
    // - soft budget idle 不会抹掉 diff
    // - loading/error/unchanged 期间继续显示旧正文
    // 真正替换只发生在 current.kind === "loaded"。
    if (retainedLoaded && current.kind !== "loaded") {
      if (current.kind === "error") {
        this.#refreshFailures.set(entryKey, current);
      } else {
        this.#refreshFailures.delete(entryKey);
      }
      if (current.kind === "unchanged") {
        this.#staleEntryKeys.add(entryKey);
      } else {
        this.#staleEntryKeys.delete(entryKey);
      }
      this.#replaceEffective(entryKey, retainedLoaded, changed);
      return;
    }
    this.#refreshFailures.delete(entryKey);
    this.#staleEntryKeys.delete(entryKey);
    this.#replaceEffective(entryKey, current, changed);
  }
}
