import { describe, expect, it } from "vitest";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
} from "../../../src/plugins/builtin/git/renderer/git-review-document-limits.ts";
import type { GitReviewDocumentResource } from "../../../src/plugins/builtin/git/renderer/git-review-document-resource.ts";
import type { GitReviewIndexLoaderSnapshot } from "../../../src/plugins/builtin/git/renderer/git-review-index-loader.ts";
import {
  clearAllReviewSessionsForTests,
  clearReviewSession,
  patchReviewSession,
  readReviewSession,
  writeReviewSession,
} from "../../../src/plugins/builtin/git/renderer/git-review-session-cache.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
  GitReviewIndexOk,
} from "../../../src/shared/contracts/git-review.ts";

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
  return {
    kind: "ok",
    revision: `document:${item.entryKey}`,
    sections: [
      {
        kind: "patch",
        patch: content,
        sectionKey: slot.sectionKey,
      },
    ],
  };
}

function loadedIndex(
  entries: readonly GitReviewIndexEntry[],
  generation = 1
): Extract<GitReviewIndexLoaderSnapshot, { kind: "loaded" }> {
  const result: GitReviewIndexOk = {
    entries: [...entries],
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
