import type { GitReviewFileDocumentOk } from "@shared/contracts/git-review.ts";
import {
  type GitReviewRetentionLimits,
  gitReviewDocumentMetrics,
} from "./git-review-document-limits.ts";

interface RetainedMetrics {
  readonly bytes: number;
  readonly lines: number;
}

/** 字节/行数软预算的 O(1) LRU；可见项可短暂超预算，离窗后立即收敛。 */
export class GitReviewDocumentRetention {
  readonly #entries = new Map<string, RetainedMetrics>();
  #limits: GitReviewRetentionLimits;
  #pinnedEntryKeys = new Set<string>();
  #totalBytes = 0;
  #totalLines = 0;

  constructor(limits: GitReviewRetentionLimits) {
    this.#limits = limits;
  }

  clear(): void {
    this.#entries.clear();
    this.#pinnedEntryKeys.clear();
    this.#totalBytes = 0;
    this.#totalLines = 0;
  }

  retainedEntryKeys(): readonly string[] {
    return [...this.#entries.keys()];
  }

  retain(entryKey: string, document: GitReviewFileDocumentOk): string[] {
    this.#delete(entryKey);
    const metrics = gitReviewDocumentMetrics(document);
    this.#entries.set(entryKey, metrics);
    this.#totalBytes += metrics.bytes;
    this.#totalLines += metrics.lines;
    return this.#enforceLimits(entryKey);
  }

  setLimits(limits: GitReviewRetentionLimits): string[] {
    this.#limits = limits;
    return this.#enforceLimits(null);
  }

  setPinnedEntryKeys(entryKeys: ReadonlySet<string>): string[] {
    this.#pinnedEntryKeys = new Set(entryKeys);
    return this.#enforceLimits(null);
  }

  touch(entryKey: string): void {
    const metrics = this.#entries.get(entryKey);
    if (!metrics) {
      return;
    }
    this.#entries.delete(entryKey);
    this.#entries.set(entryKey, metrics);
  }

  #delete(entryKey: string): void {
    const metrics = this.#entries.get(entryKey);
    if (!metrics) {
      return;
    }
    this.#entries.delete(entryKey);
    this.#totalBytes -= metrics.bytes;
    this.#totalLines -= metrics.lines;
  }

  #enforceLimits(preferredEntryKey: string | null): string[] {
    const evictedEntryKeys: string[] = [];
    while (
      this.#totalBytes > this.#limits.maxRetainedBytes ||
      this.#totalLines > this.#limits.maxRetainedLines
    ) {
      let candidate: string | null = null;
      for (const entryKey of this.#entries.keys()) {
        if (
          entryKey !== preferredEntryKey &&
          !this.#pinnedEntryKeys.has(entryKey)
        ) {
          candidate = entryKey;
          break;
        }
      }
      if (
        candidate === null &&
        preferredEntryKey !== null &&
        !this.#pinnedEntryKeys.has(preferredEntryKey)
      ) {
        candidate = preferredEntryKey;
      }
      if (candidate === null) {
        break;
      }
      this.#delete(candidate);
      evictedEntryKeys.push(candidate);
    }
    return evictedEntryKeys;
  }
}
