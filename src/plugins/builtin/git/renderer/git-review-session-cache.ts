import type { PierDiffViewAnchor } from "@pier/ui/diff-view.tsx";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  gitReviewDocumentMetrics,
  isGitReviewDocumentReservable,
} from "./git-review-document-limits.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";
import type { GitReviewIndexLoaderSnapshot } from "./git-review-index-loader.ts";

/** JSON.stringify(GitReviewScope) — 与 panel sourceKey 一致。 */
export type ReviewSessionSourceKey = string;

type LoadedReviewIndex = Extract<
  GitReviewIndexLoaderSnapshot,
  { kind: "loaded" }
>;
type LoadedReviewDocument = Extract<
  GitReviewDocumentResource,
  { kind: "loaded" }
>;

export interface ReviewSessionCacheEntry {
  readonly anchor: PierDiffViewAnchor | null;
  readonly index: LoadedReviewIndex;
  readonly loadedByEntryKey: ReadonlyMap<string, LoadedReviewDocument>;
  readonly retainedEntryKeys: readonly string[];
  readonly selectedEntryKey: string | null;
  readonly sourceKey: ReviewSessionSourceKey;
}

const MAX_SESSION_SOURCE_KEYS = 16;
const GLOBAL_SESSIONS_KEY = "__pierGitReviewSessions__";

type SessionMap = Map<ReviewSessionSourceKey, ReviewSessionCacheEntry>;

function sessionsStore(): SessionMap {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_SESSIONS_KEY]?: SessionMap;
  };
  if (!globalStore[GLOBAL_SESSIONS_KEY]) {
    globalStore[GLOBAL_SESSIONS_KEY] = new Map();
  }
  return globalStore[GLOBAL_SESSIONS_KEY];
}

function touch(sourceKey: ReviewSessionSourceKey): void {
  const sessions = sessionsStore();
  const existing = sessions.get(sourceKey);
  if (!existing) {
    return;
  }
  sessions.delete(sourceKey);
  sessions.set(sourceKey, existing);
}

function evictOldestSourceKeys(): void {
  const sessions = sessionsStore();
  while (sessions.size > MAX_SESSION_SOURCE_KEYS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    sessions.delete(oldest);
  }
}

function trimLoadedDocuments(
  loadedByEntryKey: ReadonlyMap<string, LoadedReviewDocument>,
  retainedEntryKeys: readonly string[],
  selectedEntryKey: string | null
): {
  readonly loadedByEntryKey: ReadonlyMap<string, LoadedReviewDocument>;
  readonly retainedEntryKeys: readonly string[];
} {
  const nextLoaded = new Map(loadedByEntryKey);
  const nextRetained = [...retainedEntryKeys];

  for (const [entryKey, resource] of nextLoaded) {
    if (!isGitReviewDocumentReservable(resource.document)) {
      nextLoaded.delete(entryKey);
      const index = nextRetained.indexOf(entryKey);
      if (index >= 0) {
        nextRetained.splice(index, 1);
      }
    }
  }

  const total = () => {
    let bytes = 0;
    let lines = 0;
    for (const resource of nextLoaded.values()) {
      const metrics = gitReviewDocumentMetrics(resource.document);
      bytes += metrics.bytes;
      lines += metrics.lines;
    }
    return { bytes, lines };
  };

  while (nextRetained.length > 0) {
    const { bytes, lines } = total();
    if (
      bytes <= GIT_REVIEW_MAX_RETAINED_BYTES &&
      lines <= GIT_REVIEW_MAX_RETAINED_LINES
    ) {
      break;
    }
    const victimIndex = nextRetained.findIndex(
      (entryKey) => entryKey !== selectedEntryKey
    );
    if (victimIndex < 0) {
      break;
    }
    const [victim] = nextRetained.splice(victimIndex, 1);
    if (victim !== undefined) {
      nextLoaded.delete(victim);
    }
  }

  // retained 顺序最旧→最新；剔除已不在 map 中的 key。
  const prunedRetained = nextRetained.filter((entryKey) =>
    nextLoaded.has(entryKey)
  );
  for (const entryKey of nextLoaded.keys()) {
    if (!prunedRetained.includes(entryKey)) {
      prunedRetained.push(entryKey);
    }
  }

  return {
    loadedByEntryKey: nextLoaded,
    retainedEntryKeys: Object.freeze([...prunedRetained]),
  };
}

function normalizeEntry(
  entry: ReviewSessionCacheEntry
): ReviewSessionCacheEntry {
  const trimmed = trimLoadedDocuments(
    entry.loadedByEntryKey,
    entry.retainedEntryKeys,
    entry.selectedEntryKey
  );
  return {
    anchor: entry.anchor,
    index: entry.index,
    loadedByEntryKey: trimmed.loadedByEntryKey,
    retainedEntryKeys: trimmed.retainedEntryKeys,
    selectedEntryKey: entry.selectedEntryKey,
    sourceKey: entry.sourceKey,
  };
}

export function readReviewSession(
  sourceKey: ReviewSessionSourceKey
): ReviewSessionCacheEntry | null {
  const entry = sessionsStore().get(sourceKey);
  if (!entry) {
    return null;
  }
  touch(sourceKey);
  return entry;
}

export function writeReviewSession(entry: ReviewSessionCacheEntry): void {
  if (entry.index.kind !== "loaded") {
    return;
  }
  const sessions = sessionsStore();
  sessions.delete(entry.sourceKey);
  sessions.set(entry.sourceKey, normalizeEntry(entry));
  evictOldestSourceKeys();
}

export function patchReviewSession(
  sourceKey: ReviewSessionSourceKey,
  patch: Partial<Omit<ReviewSessionCacheEntry, "sourceKey">>
): void {
  const sessions = sessionsStore();
  const existing = sessions.get(sourceKey);
  if (!existing) {
    const index = patch.index;
    if (index?.kind !== "loaded") {
      return;
    }
    writeReviewSession({
      anchor: patch.anchor ?? null,
      index,
      loadedByEntryKey: patch.loadedByEntryKey ?? new Map(),
      retainedEntryKeys: patch.retainedEntryKeys ?? [],
      selectedEntryKey: patch.selectedEntryKey ?? null,
      sourceKey,
    });
    return;
  }

  const nextIndex =
    patch.index && patch.index.kind === "loaded" ? patch.index : existing.index;
  const next: ReviewSessionCacheEntry = {
    anchor: patch.anchor === undefined ? existing.anchor : patch.anchor,
    index: nextIndex,
    loadedByEntryKey:
      patch.loadedByEntryKey === undefined
        ? existing.loadedByEntryKey
        : patch.loadedByEntryKey,
    retainedEntryKeys:
      patch.retainedEntryKeys === undefined
        ? existing.retainedEntryKeys
        : patch.retainedEntryKeys,
    selectedEntryKey:
      patch.selectedEntryKey === undefined
        ? existing.selectedEntryKey
        : patch.selectedEntryKey,
    sourceKey,
  };
  sessions.delete(sourceKey);
  sessions.set(sourceKey, normalizeEntry(next));
  evictOldestSourceKeys();
}

export function clearReviewSession(sourceKey: ReviewSessionSourceKey): void {
  sessionsStore().delete(sourceKey);
}

export function clearAllReviewSessionsForTests(): void {
  sessionsStore().clear();
}
