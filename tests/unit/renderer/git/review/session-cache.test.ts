import { describe, expect, it } from "vitest";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/limits.ts";
import type { GitReviewDocumentResource } from "../../../../../src/plugins/builtin/git/renderer/review/document/resource.ts";
import type { GitReviewIndexLoaderSnapshot } from "../../../../../src/plugins/builtin/git/renderer/review/index-loader.ts";
import {
  clearAllReviewSessionsForTests,
  clearReviewSession,
  clearReviewSessionsForScope,
  ensureReviewSurfaceSession,
  patchReviewSession,
  readReviewSession,
  reviewSurfaceSessionKey,
  writeReviewSession,
} from "../../../../../src/plugins/builtin/git/renderer/review/session-cache.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
  GitReviewIndexOk,
} from "../../../../../src/shared/contracts/git/review.ts";
import { patchDocument } from "./document/fixture.ts";

type LoadedDocument = Extract<GitReviewDocumentResource, { kind: "loaded" }>;
function entry(index: number): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}:${path}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

function documentFor(
  item: GitReviewIndexEntry,
  content: string
): GitReviewFileDocumentOk {
  const slot = item.renderSlots[0];
  if (!slot) {
    throw new Error("missing patch slot");
  }
  return patchDocument({
    entryKey: item.entryKey,
    patch: content,
    revision: `document:${item.entryKey}`,
    sectionKey: slot.sectionKey,
  });
}

function loadedIndex(
  entries: readonly GitReviewIndexEntry[],
  generation = 1
): Extract<GitReviewIndexLoaderSnapshot, { kind: "loaded" }> {
  const result: GitReviewIndexOk = {
    entries: [...entries],
    groupSummaries: {},
    kind: "ok",
    warnings: [],
  };
  return {
    generation,
    kind: "loaded",
    refreshFailure: null,
    refreshing: false,
    result,
  };
}

function loadedDoc(item: GitReviewIndexEntry, content: string): LoadedDocument {
  return {
    document: documentFor(item, content),
    entry: item,
    kind: "loaded",
  };
}

describe("git-review-session-cache", () => {
  it("drops invalid legacy documents and preserves a valid section anchor", () => {
    clearAllReviewSessionsForTests();
    const item = entry(0);
    const legacy = loadedDoc(item, "diff\n");
    Reflect.deleteProperty(legacy.document, "sections");
    writeReviewSession({
      anchor: { id: "section:0", offset: -12 },
      index: loadedIndex([item]),
      loadedByEntryKey: new Map([[item.entryKey, legacy]]),
      retainedEntryKeys: [item.entryKey],
      selectedEntryKey: item.entryKey,
      selectedSectionKey: "section:0",
      sourceKey: "legacy-source",
    });

    const restored = readReviewSession("legacy-source");
    expect(restored?.anchor).toEqual({ id: "section:0", offset: -12 });
    expect(restored?.loadedByEntryKey.size).toBe(0);
    expect(restored?.retainedEntryKeys).toEqual([]);
  });

  it("writes and reads a session; hit moves to LRU tail", () => {
    clearAllReviewSessionsForTests();
    const first = entry(0);
    writeReviewSession({
      anchor: { id: "section:0", offset: 12 },
      index: loadedIndex([first]),
      loadedByEntryKey: new Map([[first.entryKey, loadedDoc(first, "a\n")]]),
      retainedEntryKeys: [first.entryKey],
      selectedEntryKey: first.entryKey,
      selectedSectionKey: "section:0",
      sourceKey: "source-a",
    });
    writeReviewSession({
      anchor: null,
      index: loadedIndex([entry(1)]),
      loadedByEntryKey: new Map(),
      retainedEntryKeys: [],
      selectedEntryKey: null,
      selectedSectionKey: null,
      sourceKey: "source-b",
    });

    expect(readReviewSession("source-a")?.selectedEntryKey).toBe(
      first.entryKey
    );
    // touch a → b 成为最旧
    writeReviewSession({
      anchor: null,
      index: loadedIndex([entry(2)]),
      loadedByEntryKey: new Map(),
      retainedEntryKeys: [],
      selectedEntryKey: null,
      selectedSectionKey: null,
      sourceKey: "source-c",
    });
    expect(readReviewSession("source-a")?.anchor).toEqual({
      id: "section:0",
      offset: 12,
    });
  });

  it("evicts oldest sourceKey beyond 16", () => {
    clearAllReviewSessionsForTests();
    for (let index = 0; index < 17; index += 1) {
      writeReviewSession({
        anchor: null,
        index: loadedIndex([entry(index)]),
        loadedByEntryKey: new Map(),
        retainedEntryKeys: [],
        selectedEntryKey: null,
        selectedSectionKey: null,
        sourceKey: `source-${index}`,
      });
    }
    expect(readReviewSession("source-0")).toBeNull();
    expect(readReviewSession("source-16")?.sourceKey).toBe("source-16");
  });

  it("patch without existing entry and no loaded index is a no-op", () => {
    clearAllReviewSessionsForTests();
    patchReviewSession("missing", {
      selectedEntryKey: "entry:1",
      loadedByEntryKey: new Map(),
    });
    expect(readReviewSession("missing")).toBeNull();
  });

  it("clearReviewSession drops one sourceKey only", () => {
    clearAllReviewSessionsForTests();
    writeReviewSession({
      anchor: null,
      index: loadedIndex([entry(0)]),
      loadedByEntryKey: new Map(),
      retainedEntryKeys: [],
      selectedEntryKey: null,
      selectedSectionKey: null,
      sourceKey: "keep",
    });
    writeReviewSession({
      anchor: null,
      index: loadedIndex([entry(1)]),
      loadedByEntryKey: new Map(),
      retainedEntryKeys: [],
      selectedEntryKey: null,
      selectedSectionKey: null,
      sourceKey: "drop",
    });
    clearReviewSession("drop");
    expect(readReviewSession("drop")).toBeNull();
    expect(readReviewSession("keep")?.sourceKey).toBe("keep");
  });

  it("keeps surface selection isolated and clears the whole scope together", () => {
    clearAllReviewSessionsForTests();
    const scope = {
      contextId: "ctx:surface",
      gitRootPath: "/workspace/surface",
      target: { kind: "uncommitted" as const },
    };
    const baseKey = JSON.stringify(scope);
    writeReviewSession({
      anchor: null,
      index: loadedIndex([entry(0)]),
      loadedByEntryKey: new Map(),
      retainedEntryKeys: [],
      selectedEntryKey: null,
      selectedSectionKey: null,
      sourceKey: baseKey,
    });
    const indexKey = ensureReviewSurfaceSession(scope, "index");
    const conflictKey = ensureReviewSurfaceSession(scope, "conflict");
    const stagedKey = ensureReviewSurfaceSession(scope, "staged");
    patchReviewSession(indexKey, {
      selectedEntryKey: "entry:index",
      selectedSectionKey: "section:index",
    });

    expect(readReviewSession(indexKey)?.selectedEntryKey).toBe("entry:index");
    expect(readReviewSession(conflictKey)?.selectedEntryKey).toBeNull();
    expect(readReviewSession(stagedKey)?.selectedEntryKey).toBeNull();
    expect(conflictKey).toBe(reviewSurfaceSessionKey(scope, "conflict"));
    expect(conflictKey).not.toBe(indexKey);
    expect(stagedKey).toBe(reviewSurfaceSessionKey(scope, "staged"));

    clearReviewSessionsForScope(scope);
    expect(readReviewSession(baseKey)).toBeNull();
    expect(readReviewSession(conflictKey)).toBeNull();
    expect(readReviewSession(indexKey)).toBeNull();
    expect(readReviewSession(stagedKey)).toBeNull();
  });

  it("seeds a new surface session with loaded bodies from sibling surfaces", () => {
    clearAllReviewSessionsForTests();
    const scope = {
      contextId: "ctx:stage-handoff",
      gitRootPath: "/workspace/stage-handoff",
      target: { kind: "uncommitted" as const },
    };
    const item = entry(0);
    const indexKey = reviewSurfaceSessionKey(scope, "index");
    writeReviewSession({
      anchor: null,
      index: loadedIndex([item]),
      loadedByEntryKey: new Map([[item.entryKey, loadedDoc(item, "diff a\n")]]),
      retainedEntryKeys: [item.entryKey],
      selectedEntryKey: item.entryKey,
      selectedSectionKey: "section:0",
      sourceKey: indexKey,
    });

    const stagedKey = ensureReviewSurfaceSession(scope, "staged");
    const staged = readReviewSession(stagedKey);
    expect(stagedKey).toBe(reviewSurfaceSessionKey(scope, "staged"));
    expect(staged?.selectedEntryKey).toBeNull();
    expect(staged?.loadedByEntryKey.has(item.entryKey)).toBe(true);
    expect(staged?.retainedEntryKeys).toContain(item.entryKey);
  });

  it("evicts oldest retained docs under budget but protects selected", () => {
    clearAllReviewSessionsForTests();
    const selected = entry(0);
    const older = entry(1);
    // 两份正文各自可保留，但合计超过 32MiB 字节预算（UTF-16 按 length*2）。
    const hugeChunk = "x".repeat(GIT_REVIEW_MAX_RETAINED_BYTES / 4 + 1024);
    const selectedDoc = loadedDoc(selected, `${hugeChunk}\n`);
    const olderDoc = loadedDoc(older, `${hugeChunk}\n`);
    writeReviewSession({
      anchor: null,
      index: loadedIndex([selected, older]),
      loadedByEntryKey: new Map([
        [older.entryKey, olderDoc],
        [selected.entryKey, selectedDoc],
      ]),
      retainedEntryKeys: [older.entryKey, selected.entryKey],
      selectedEntryKey: selected.entryKey,
      selectedSectionKey: null,
      sourceKey: "budget",
    });
    const session = readReviewSession("budget");
    expect(session).not.toBeNull();
    expect(session?.loadedByEntryKey.has(selected.entryKey)).toBe(true);
    expect(session?.loadedByEntryKey.has(older.entryKey)).toBe(false);
    expect(session?.retainedEntryKeys).toEqual([selected.entryKey]);
  });

  it("drops a single document that exceeds the line budget alone", () => {
    clearAllReviewSessionsForTests();
    const item = entry(0);
    const lines = Array.from(
      { length: GIT_REVIEW_MAX_RETAINED_LINES + 10 },
      (_, index) => `line-${index}`
    ).join("\n");
    writeReviewSession({
      anchor: null,
      index: loadedIndex([item]),
      loadedByEntryKey: new Map([[item.entryKey, loadedDoc(item, lines)]]),
      retainedEntryKeys: [item.entryKey],
      selectedEntryKey: item.entryKey,
      selectedSectionKey: null,
      sourceKey: "oversize",
    });
    const session = readReviewSession("oversize");
    expect(session?.loadedByEntryKey.size).toBe(0);
    expect(session?.retainedEntryKeys).toEqual([]);
  });
});
