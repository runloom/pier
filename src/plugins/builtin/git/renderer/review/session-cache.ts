import type { PierDiffViewAnchor } from "@pier/ui/diff-view/index.tsx";
import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  gitReviewDocumentMetrics,
  isGitReviewDocumentReservable,
} from "./document/limits.ts";
import type { GitReviewDocumentResource } from "./document/resource.ts";
import {
  clearAllReviewDocumentSoftCachesForTests,
  clearReviewDocumentSoftCache,
  reviewDocumentSoftCacheScopeKey,
} from "./document/soft-cache.ts";
import type { GitReviewIndexLoaderSnapshot } from "./index-loader.ts";
import type { GitReviewReadingSurface } from "./reading-surface.ts";
import { GIT_REVIEW_READING_SURFACES } from "./surface-group.ts";

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
  readonly selectedSectionKey: string | null;
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
    if (
      !(
        isCanonicalLoadedDocument(entryKey, resource) &&
        isGitReviewDocumentReservable(resource.document)
      )
    ) {
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

function isCanonicalLoadedDocument(
  entryKey: string,
  resource: LoadedReviewDocument
): boolean {
  const document: unknown = resource.document;
  return (
    typeof document === "object" &&
    document !== null &&
    "sections" in document &&
    "entryKey" in document &&
    document.entryKey === entryKey &&
    resource.entry.entryKey === entryKey
  );
}

function normalizeAnchor(
  entry: ReviewSessionCacheEntry
): PierDiffViewAnchor | null {
  if (entry.anchor === null) {
    return null;
  }
  for (const indexEntry of entry.index.result.entries) {
    if (indexEntry.entryKey === entry.anchor.id) {
      const firstSectionKey = indexEntry.renderSlots[0]?.sectionKey;
      return firstSectionKey === undefined
        ? entry.anchor
        : { ...entry.anchor, id: firstSectionKey };
    }
    if (
      indexEntry.renderSlots.some(
        (slot) => slot.sectionKey === entry.anchor?.id
      )
    ) {
      return entry.anchor;
    }
  }
  return entry.anchor;
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
    anchor: normalizeAnchor(entry),
    index: entry.index,
    loadedByEntryKey: trimmed.loadedByEntryKey,
    retainedEntryKeys: trimmed.retainedEntryKeys,
    selectedEntryKey: entry.selectedEntryKey,
    selectedSectionKey: entry.selectedSectionKey,
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
      selectedSectionKey: patch.selectedSectionKey ?? null,
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
    selectedSectionKey:
      patch.selectedSectionKey === undefined
        ? existing.selectedSectionKey
        : patch.selectedSectionKey,
    sourceKey,
  };
  sessions.delete(sourceKey);
  sessions.set(sourceKey, normalizeEntry(next));
  evictOldestSourceKeys();
}

export function clearReviewSession(sourceKey: ReviewSessionSourceKey): void {
  sessionsStore().delete(sourceKey);
}

export function reviewSurfaceSessionKey(
  scope: GitReviewScope,
  diffBase: GitReviewReadingSurface
): ReviewSessionSourceKey {
  return JSON.stringify([scope, diffBase]);
}

/**
 * 收集同一 scope 下已有会话（base + 各阅读面）的 loaded 正文，供新面 soft-retain。
 * 选择 / anchor 仍面隔离；正文按 entryKey 合并（后写覆盖）。
 */
function mergeLoadedDocumentsForScope(scope: GitReviewScope): {
  readonly loadedByEntryKey: Map<string, LoadedReviewDocument>;
  readonly retainedEntryKeys: string[];
} {
  const loadedByEntryKey = new Map<string, LoadedReviewDocument>();
  const retainedOrder: string[] = [];
  const seenRetained = new Set<string>();
  const candidateKeys = [
    JSON.stringify(scope),
    ...GIT_REVIEW_READING_SURFACES.map((surface) =>
      reviewSurfaceSessionKey(scope, surface)
    ),
  ];
  for (const key of candidateKeys) {
    const session = sessionsStore().get(key);
    if (session === undefined) {
      continue;
    }
    for (const [entryKey, resource] of session.loadedByEntryKey) {
      if (
        isCanonicalLoadedDocument(entryKey, resource) &&
        isGitReviewDocumentReservable(resource.document)
      ) {
        loadedByEntryKey.set(entryKey, resource);
      }
    }
    for (const entryKey of session.retainedEntryKeys) {
      if (loadedByEntryKey.has(entryKey) && !seenRetained.has(entryKey)) {
        seenRetained.add(entryKey);
        retainedOrder.push(entryKey);
      }
    }
  }
  for (const entryKey of loadedByEntryKey.keys()) {
    if (!seenRetained.has(entryKey)) {
      retainedOrder.push(entryKey);
    }
  }
  return {
    loadedByEntryKey,
    retainedEntryKeys: retainedOrder,
  };
}

/**
 * 阅读面第一次挂载时从同一 scope 建立独立状态槽。
 * 选择 / anchor 面隔离；**loaded 正文从兄弟面合并**，避免 stage 切面首帧 estimate 空白。
 */
export function ensureReviewSurfaceSession(
  scope: GitReviewScope,
  diffBase: GitReviewReadingSurface
): ReviewSessionSourceKey {
  const sourceKey = reviewSurfaceSessionKey(scope, diffBase);
  if (sessionsStore().has(sourceKey)) {
    return sourceKey;
  }
  const base = sessionsStore().get(JSON.stringify(scope));
  const merged = mergeLoadedDocumentsForScope(scope);
  if (base === undefined && merged.loadedByEntryKey.size === 0) {
    return sourceKey;
  }
  const index = base?.index;
  if (index === undefined || index.kind !== "loaded") {
    // 无 index 时仍可只种正文（stage 目标面冷启动）；缺 index 的 session 不经 write 持久化路径。
    if (merged.loadedByEntryKey.size === 0) {
      return sourceKey;
    }
    // 用兄弟面任意 loaded index，否则无法 writeReviewSession
    for (const surface of GIT_REVIEW_READING_SURFACES) {
      const peer = sessionsStore().get(reviewSurfaceSessionKey(scope, surface));
      if (peer?.index.kind === "loaded") {
        writeReviewSession({
          anchor: null,
          index: peer.index,
          loadedByEntryKey: merged.loadedByEntryKey,
          retainedEntryKeys: merged.retainedEntryKeys,
          selectedEntryKey: null,
          selectedSectionKey: null,
          sourceKey,
        });
        return sourceKey;
      }
    }
    return sourceKey;
  }
  writeReviewSession({
    anchor: null,
    index,
    loadedByEntryKey: merged.loadedByEntryKey,
    retainedEntryKeys: merged.retainedEntryKeys,
    selectedEntryKey: null,
    selectedSectionKey: null,
    sourceKey,
  });
  return sourceKey;
}

export function clearReviewSessionsForScope(scope: GitReviewScope): void {
  clearReviewSession(JSON.stringify(scope));
  for (const diffBase of GIT_REVIEW_READING_SURFACES) {
    clearReviewSession(reviewSurfaceSessionKey(scope, diffBase));
  }
  clearReviewDocumentSoftCache(reviewDocumentSoftCacheScopeKey(scope));
}

export function clearAllReviewSessionsForTests(): void {
  sessionsStore().clear();
  clearAllReviewDocumentSoftCachesForTests();
}
