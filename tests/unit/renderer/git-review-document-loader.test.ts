import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it, vi } from "vitest";
import { GitReviewDocumentLoader } from "../../../src/plugins/builtin/git/renderer/git-review-document-loader.ts";
import type { GitReviewDocumentResource } from "../../../src/plugins/builtin/git/renderer/git-review-document-resource.ts";

function entry(
  index: number,
  groups: readonly GitReviewGroup[] = ["unstaged"]
): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: groups.map((group) => ({
      group,
      oldPath: null,
      sectionKey: `section:${index}:${group}`,
      status: "modified",
      targetPath: path,
    })),
    status: "modified",
  };
}

function documentFor(
  item: GitReviewIndexEntry,
  content = "const value = 1;"
): GitReviewFileDocumentOk {
  return {
    kind: "ok",
    revision: `revision:${item.entryKey}:${content.length}`,
    sections: item.renderSlots.map((slot) => ({
      kind: "patch" as const,
      patch: [
        `diff --git a/${slot.targetPath} b/${slot.targetPath}`,
        `--- a/${slot.targetPath}`,
        `+++ b/${slot.targetPath}`,
        "@@ -1 +1 @@",
        `-${content}`,
        `+${content} changed`,
        "",
      ].join("\n"),
      sectionKey: slot.sectionKey,
    })),
  };
}

function stateDocumentFor(item: GitReviewIndexEntry): GitReviewFileDocumentOk {
  const slot = item.renderSlots[0];
  if (!slot) {
    throw new Error("missing slot");
  }
  return {
    kind: "ok",
    revision: `revision:${item.entryKey}:state`,
    sections: [
      {
        kind: "state",
        oldPath: null,
        reason: "binary",
        sectionKey: slot.sectionKey,
        status: slot.status,
        targetPath: slot.targetPath,
      },
    ],
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("GitReviewDocumentLoader", () => {
  it("does not load any document before demand is set", () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const load = vi.fn(async (item: GitReviewIndexEntry) => documentFor(item));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });

    expect(load).not.toHaveBeenCalled();
    expect(loader.getSnapshot().resources).toHaveLength(2001);
    expect(
      loader
        .getSnapshot()
        .resources.every((resource) => resource.kind === "idle")
    ).toBe(true);

    // 仅 protect 不构成 demand；seed 是合法首 demand，但必须显式 setWindowDemand。
    loader.setProtectedEntryKey("entry:2000");
    expect(load).not.toHaveBeenCalled();
  });

  it("loads only seed demand entries with bounded concurrency", async () => {
    const entries = Array.from({ length: 200 }, (_, index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    let active = 0;
    let maxActive = 0;
    const load = vi.fn((item: GitReviewIndexEntry) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const request = deferred<GitReviewFileDocumentResult>();
      pending.set(item.entryKey, request);
      return request.promise.finally(() => {
        active -= 1;
      });
    });
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });

    const seedKeys = Array.from({ length: 25 }, (_, index) => `entry:${index}`);
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: seedKeys,
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:0",
      "entry:1",
    ]);
    for (const entryKey of seedKeys.slice(0, 2)) {
      pending
        .get(entryKey)
        ?.resolve(
          documentFor(entries[Number(entryKey.slice(6))] as GitReviewIndexEntry)
        );
      await flush();
    }
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(load.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it("loads only the visible and official buffered entries with bounded concurrency", async () => {
    const entries = Array.from({ length: 209 }, (_, index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    let active = 0;
    let maxActive = 0;
    const load = vi.fn((item: GitReviewIndexEntry) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const request = deferred<GitReviewFileDocumentResult>();
      pending.set(item.entryKey, request);
      return request.promise.finally(() => {
        active -= 1;
      });
    });
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: ["entry:8"],
      visibleEntryKeys: ["entry:5", "entry:6", "entry:7"],
    });
    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:5",
      "entry:6",
    ]);

    pending
      .get("entry:5")
      ?.resolve(documentFor(entries[5] as GitReviewIndexEntry));
    await flush();
    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:5",
      "entry:6",
      "entry:7",
    ]);
    pending
      .get("entry:6")
      ?.resolve(documentFor(entries[6] as GitReviewIndexEntry));
    await flush();
    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:5",
      "entry:6",
      "entry:7",
      "entry:8",
    ]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("prioritizes a selected entry after Pierre includes it in the window", () => {
    const entries = Array.from({ length: 20 }, (_, index) => entry(index));
    const load = vi.fn(
      (_item: GitReviewIndexEntry) =>
        deferred<GitReviewFileDocumentResult>().promise
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });

    loader.setProtectedEntryKey("entry:19");
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: Array.from(
        { length: 14 },
        (_, index) => `entry:${index + 6}`
      ),
    });

    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:19",
      "entry:6",
    ]);
  });

  it("keeps the selected request when placeholder reflow shifts the Pierre window", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const cancel = vi.fn(async () => undefined);
    const load = vi.fn(() => deferred<GitReviewFileDocumentResult>().promise);
    const loader = new GitReviewDocumentLoader({ cancel, entries, load });

    loader.setProtectedEntryKey("entry:2");
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:1", "entry:2"],
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:0"],
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(loader.getSnapshot().resources[2]?.kind).toBe("loading");
  });

  it("replaces queued demand when the Pierre window changes", async () => {
    const entries = Array.from({ length: 6 }, (_, index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const load = vi.fn((item: GitReviewIndexEntry) => {
      const request = deferred<GitReviewFileDocumentResult>();
      pending.set(item.entryKey, request);
      return request.promise;
    });
    const cancel = vi.fn(async () => undefined);
    const loader = new GitReviewDocumentLoader({
      cancel,
      entries,
      load,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: ["entry:2", "entry:3"],
      visibleEntryKeys: ["entry:0", "entry:1"],
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:4", "entry:5"],
    });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:0",
      "entry:1",
    ]);
    pending
      .get("entry:0")
      ?.resolve(documentFor(entries[0] as GitReviewIndexEntry));
    pending
      .get("entry:1")
      ?.resolve(documentFor(entries[1] as GitReviewIndexEntry));
    await flush();

    expect(load.mock.calls.map(([item]) => item.entryKey)).toEqual([
      "entry:0",
      "entry:1",
      "entry:4",
      "entry:5",
    ]);

    expect(loader.getSnapshot().resources[0]?.kind).toBe("idle");
  });

  it("does not reload an unchanged window or a cached document", async () => {
    const entries = [entry(0), entry(1)];
    const load = vi.fn(async (item: GitReviewIndexEntry) => documentFor(item));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });
    const demand = {
      bufferedEntryKeys: ["entry:1"],
      visibleEntryKeys: ["entry:0"],
    };

    loader.setWindowDemand(demand);
    await flush();
    loader.setWindowDemand(demand);
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [],
    });
    loader.setWindowDemand(demand);
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("validates that document sections match the index slots", async () => {
    const item = entry(0, ["unstaged", "staged"]);
    const load = vi.fn(async () => ({
      ...documentFor(item),
      sections: documentFor(item).sections.slice(0, 1),
    }));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [item.entryKey],
    });
    await flush();

    expect(loader.getSnapshot().resources[0]).toMatchObject({
      failure: { reason: "internal", retryable: true },
      kind: "error",
    });
  });

  it("rejects state metadata that disagrees with the index slot", async () => {
    const item = entry(0);
    const load = vi.fn(async () => {
      const document = stateDocumentFor(item);
      return {
        ...document,
        sections: document.sections.map((section) => ({
          ...section,
          targetPath: "src/other.ts",
        })),
      } satisfies GitReviewFileDocumentResult;
    });
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [item.entryKey],
    });
    await flush();

    expect(loader.getSnapshot().resources[0]).toMatchObject({
      failure: { reason: "internal", retryable: true },
      kind: "error",
    });
  });

  it("retries a retryable failure only after an explicit retry", async () => {
    const item = entry(0);
    const load = vi
      .fn<(item: GitReviewIndexEntry) => Promise<GitReviewFileDocumentResult>>()
      .mockResolvedValueOnce({
        kind: "error",
        message: "temporary",
        reason: "busy",
        retryable: true,
      })
      .mockImplementation(async (next) => documentFor(next));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [item.entryKey],
    });
    await flush();
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [],
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: [item.entryKey],
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    loader.retry(item.entryKey);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(loader.getSnapshot().resources[0]?.kind).toBe("loaded");
  });

  it("pins visible documents and restores the soft cache budget after they leave", async () => {
    const entries = [entry(0), entry(1), entry(2)];
    const load = vi.fn(async (item: GitReviewIndexEntry) =>
      stateDocumentFor(item)
    );
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      maxConcurrent: 3,
      maxRetainedBytes: 512,
      maxRetainedLines: 10,
    });

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });
    await flush();
    expect(loader.getSnapshot().retainedEntryKeys).toHaveLength(3);

    loader.setWindowDemand({ bufferedEntryKeys: [], visibleEntryKeys: [] });
    expect(loader.getSnapshot().retainedEntryKeys).toHaveLength(2);
    expect(
      loader
        .getSnapshot()
        .resources.filter((resource) => resource.kind === "loaded")
    ).toHaveLength(2);
  });

  it("does not loop-reload a buffered document evicted by a smaller soft budget", async () => {
    const entries = [entry(0), entry(1)];
    const load = vi.fn(async (item: GitReviewIndexEntry) => documentFor(item));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
      maxRetainedBytes: 1024,
      maxRetainedLines: 100,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: ["entry:1"],
      visibleEntryKeys: ["entry:0"],
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    loader.setRetentionLimits({ maxRetainedBytes: 256, maxRetainedLines: 1 });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(loader.getSnapshot().settled).toBe(true);

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:1"],
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("publishes sparse changes for a 2,001-entry topology", async () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const request = deferred<GitReviewFileDocumentResult>();
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load: vi.fn(() => request.promise),
      maxConcurrent: 1,
    });
    const changeSizes: number[] = [];
    loader.subscribe((change) => changeSizes.push(change.resources.length));

    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:2000"],
    });
    request.resolve(documentFor(entries[2000] as GitReviewIndexEntry));
    await flush();

    expect(changeSizes).toEqual([1, 1]);
  });

  it("keeps snapshot order stable when requests finish out of order", async () => {
    const entries = [entry(0), entry(1), entry(2)];
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load: (item) => {
        const request = deferred<GitReviewFileDocumentResult>();
        pending.set(item.entryKey, request);
        return request.promise;
      },
      maxConcurrent: 3,
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });

    pending
      .get("entry:2")
      ?.resolve(documentFor(entries[2] as GitReviewIndexEntry));
    pending
      .get("entry:0")
      ?.resolve(documentFor(entries[0] as GitReviewIndexEntry));
    pending
      .get("entry:1")
      ?.resolve(documentFor(entries[1] as GitReviewIndexEntry));
    await flush();

    expect(
      loader.getSnapshot().resources.map((resource) => resource.entry.entryKey)
    ).toEqual(["entry:0", "entry:1", "entry:2"]);
  });

  it("cancels active operations on dispose and ignores late results", async () => {
    const entries = [entry(0), entry(1), entry(2)];
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const cancel = vi.fn(async () => undefined);
    let operationIndex = 0;
    const loader = new GitReviewDocumentLoader({
      cancel,
      createOperationId: () =>
        `00000000-0000-4000-8000-${String(operationIndex++).padStart(12, "0")}`,
      entries,
      load: (item) => {
        const request = deferred<GitReviewFileDocumentResult>();
        pending.set(item.entryKey, request);
        return request.promise;
      },
    });
    loader.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: entries.map((item) => item.entryKey),
    });

    loader.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
    pending
      .get("entry:0")
      ?.resolve(documentFor(entries[0] as GitReviewIndexEntry));
    pending
      .get("entry:1")
      ?.resolve(documentFor(entries[1] as GitReviewIndexEntry));
    await flush();
    expect(loader.getSnapshot()).toEqual({
      retainedEntryKeys: [],
      resources: [],
      settled: true,
    });
  });

  it("hydrateLoaded restores retained docs without calling load", async () => {
    const entries = [entry(0), entry(1)];
    const load = vi.fn(async (item: GitReviewIndexEntry) => documentFor(item));
    const first = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });
    first.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:0"],
    });
    await flush();
    const loaded = first.getResource("entry:0");
    expect(loaded?.kind).toBe("loaded");
    if (loaded?.kind !== "loaded") {
      throw new Error("expected loaded");
    }
    const hydratedMap = new Map([["entry:0", loaded]]);
    first.dispose();

    const second = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries,
      load,
    });
    const callsBefore = load.mock.calls.length;
    second.hydrateLoaded(hydratedMap);
    expect(second.getResource("entry:0")?.kind).toBe("loaded");
    expect(second.getRetainedEntryKeys()).toEqual(["entry:0"]);
    second.setWindowDemand({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:0"],
    });
    await flush();
    expect(load.mock.calls.length).toBe(callsBefore);
    second.dispose();
  });

  it("hydrateLoaded skips entries whose slots no longer match", () => {
    const original = entry(0);
    const changed: GitReviewIndexEntry = {
      ...original,
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:changed",
          status: "modified",
          targetPath: original.path,
        },
      ],
    };
    const load = vi.fn(async (item: GitReviewIndexEntry) => documentFor(item));
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [changed],
      load,
    });
    const stale: Extract<GitReviewDocumentResource, { kind: "loaded" }> = {
      document: documentFor(original),
      entry: original,
      kind: "loaded",
    };
    loader.hydrateLoaded(new Map([[original.entryKey, stale]]));
    expect(loader.getResource(original.entryKey)?.kind).toBe("idle");
    expect(load).not.toHaveBeenCalled();
    loader.dispose();
  });
});
