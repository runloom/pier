import {
  GIT_REVIEW_EXCERPT_BATCH_DEFAULT,
  type GitReviewExcerptBatchResult,
  type GitReviewFileDocumentResult,
  type GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import { applyReviewNavigationDemand } from "../../../../../src/plugins/builtin/git/renderer/review/document/apply-navigation-demand.ts";
import { GitReviewDocumentLoader } from "../../../../../src/plugins/builtin/git/renderer/review/document/loader.ts";
import { GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT } from "../../../../../src/plugins/builtin/git/renderer/review/document/loader-options.ts";
import { patchDocumentForEntry } from "./document/fixture.ts";

function entry(index: number): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}:unstaged`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

function okBatch(
  batch: readonly GitReviewIndexEntry[]
): GitReviewExcerptBatchResult {
  return {
    items: batch.map((item) => ({
      path: item.path,
      result: patchDocumentForEntry(item, "const value = 1;"),
    })),
    kind: "ok",
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("GitReviewDocumentLoader excerpt batch", () => {
  it("loads a seed window in one batch IPC instead of per-file document calls", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(index));
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      patchDocumentForEntry(item, "const value = 1;")
    );
    const loadBatch = vi.fn(async (batch: readonly GitReviewIndexEntry[]) =>
      okBatch(batch)
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    expect(loadBatch).toHaveBeenCalledTimes(1);
    expect(loadBatch.mock.calls[0]?.[0]).toHaveLength(8);
    expect(load).not.toHaveBeenCalled();
    expect(
      loader
        .getSnapshot()
        .resources.filter((resource) => resource.kind === "loaded")
    ).toHaveLength(8);
  });

  it("keeps a second batch queued until the in-flight excerpt settles", async () => {
    const entries = Array.from(
      { length: GIT_REVIEW_EXCERPT_BATCH_DEFAULT + 8 },
      (_, index) => entry(index)
    );
    const pending: Array<{
      readonly batch: readonly GitReviewIndexEntry[];
      readonly resolve: (value: GitReviewExcerptBatchResult) => void;
    }> = [];
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      patchDocumentForEntry(item, "const value = 1;")
    );
    const loadBatch = vi.fn(
      (batch: readonly GitReviewIndexEntry[]) =>
        new Promise<GitReviewExcerptBatchResult>((resolve) => {
          pending.push({ batch, resolve });
        })
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.batch).toHaveLength(GIT_REVIEW_EXCERPT_BATCH_DEFAULT);
    expect(load).not.toHaveBeenCalled();

    pending[0]?.resolve(okBatch(pending[0].batch));
    await flush();
    expect(pending).toHaveLength(2);
    expect(pending[1]?.batch).toHaveLength(8);
    pending[1]?.resolve(okBatch(pending[1].batch));
    await flush();
    expect(
      loader
        .getSnapshot()
        .resources.filter((resource) => resource.kind === "loaded")
    ).toHaveLength(entries.length);
  });

  it("does not swallow a selected idle file into a fresh excerpt batch", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(index));
    const selected = entries[3];
    if (selected === undefined) {
      throw new Error("expected selected excerpt fixture");
    }
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      patchDocumentForEntry(item, "const value = 1;")
    );
    const loadBatch = vi.fn(async (batch: readonly GitReviewIndexEntry[]) =>
      okBatch(batch)
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setProtectedEntryKey(selected.entryKey);
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]?.entryKey).toBe(selected.entryKey);
    expect(loadBatch).toHaveBeenCalledTimes(1);
    expect(loadBatch.mock.calls[0]?.[0]?.map((item) => item.entryKey)).toEqual(
      entries
        .filter((item) => item.entryKey !== selected.entryKey)
        .map((item) => item.entryKey)
    );
  });

  it("boosts a selected file outside the in-flight batch with a single document load", async () => {
    const entries = Array.from(
      { length: GIT_REVIEW_EXCERPT_BATCH_DEFAULT + 1 },
      (_, index) => entry(index)
    );
    const selected = entries.at(-1);
    if (selected === undefined) {
      throw new Error("expected selected excerpt fixture");
    }
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      patchDocumentForEntry(item, "const value = 1;")
    );
    const loadBatch = vi.fn(
      () => new Promise<GitReviewExcerptBatchResult>(() => undefined)
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries
        .slice(0, GIT_REVIEW_EXCERPT_BATCH_DEFAULT)
        .map((item) => item.entryKey),
    });
    await flush();
    expect(loadBatch).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();

    loader.setProtectedEntryKey(selected.entryKey);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]?.entryKey).toBe(selected.entryKey);
    expect(loadBatch).toHaveBeenCalledTimes(1);
  });

  it("disposes a hanging batch with one cancel", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(index));
    const cancel = vi.fn(async () => undefined);
    const loader = new GitReviewDocumentLoader({
      cancel,
      entries,
      load: vi.fn(async (item: GitReviewIndexEntry) =>
        patchDocumentForEntry(item, "const value = 1;")
      ),
      loadBatch: vi.fn(
        () => new Promise<GitReviewExcerptBatchResult>(() => undefined)
      ),
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    loader.dispose();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("times out one batch member without cancelling sibling excerpt IPC", async () => {
    const entries = Array.from({ length: 4 }, (_, index) => entry(index));
    const cancel = vi.fn(async () => undefined);
    const loader = new GitReviewDocumentLoader({
      cancel,
      entries,
      load: vi.fn(async (item: GitReviewIndexEntry) =>
        patchDocumentForEntry(item, "const value = 1;")
      ),
      loadBatch: vi.fn(
        () => new Promise<GitReviewExcerptBatchResult>(() => undefined)
      ),
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    expect(loader.failHydrateTimeout([entries[0]?.entryKey ?? ""])).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(loader.getResource(entries[0]?.entryKey ?? "")?.kind).toBe("error");
    expect(loader.getResource(entries[1]?.entryKey ?? "")?.kind).toBe(
      "loading"
    );
  });

  it("tree-click boosts the selected file before packing the window batch", async () => {
    const entries = Array.from(
      { length: GIT_REVIEW_EXCERPT_BATCH_DEFAULT },
      (_, index) => entry(index)
    );
    const selected = entries[0];
    if (selected === undefined) {
      throw new Error("expected selected excerpt fixture");
    }
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      patchDocumentForEntry(item, "const value = 1;")
    );
    const loadBatch = vi.fn(async (batch: readonly GitReviewIndexEntry[]) =>
      okBatch(batch)
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    applyReviewNavigationDemand({
      currentDemand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: entries.map((item) => item.entryKey),
      },
      entryKey: selected.entryKey,
      loader,
      seedEntryKeys: [],
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]?.entryKey).toBe(selected.entryKey);
    expect(loadBatch).toHaveBeenCalledTimes(1);
    expect(
      loadBatch.mock.calls[0]?.[0]?.map((item) => item.entryKey)
    ).not.toContain(selected.entryKey);
  });

  it("re-clicking a loading selected file cancels and rearms a single load", async () => {
    const entries = Array.from({ length: 4 }, (_, index) => entry(index));
    const selected = entries[0];
    if (selected === undefined) {
      throw new Error("expected selected excerpt fixture");
    }
    const cancel = vi.fn(async () => undefined);
    const load = vi.fn(
      () => new Promise<GitReviewFileDocumentResult>(() => undefined)
    );
    const loadBatch = vi.fn(
      () => new Promise<GitReviewExcerptBatchResult>(() => undefined)
    );
    const loader = new GitReviewDocumentLoader({
      cancel,
      entries,
      load,
      loadBatch,
      maxConcurrent: GIT_REVIEW_EXCERPT_MAX_IN_FLIGHT,
    });
    const demand = {
      bufferedEntryKeys: [] as const,
      visibleEntryKeys: entries.map((item) => item.entryKey),
    };
    applyReviewNavigationDemand({
      currentDemand: demand,
      entryKey: selected.entryKey,
      loader,
      seedEntryKeys: [],
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    applyReviewNavigationDemand({
      currentDemand: demand,
      entryKey: selected.entryKey,
      loader,
      seedEntryKeys: [],
    });
    await flush();
    expect(cancel).toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
