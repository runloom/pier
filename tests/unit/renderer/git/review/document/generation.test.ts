import { GitReviewDocumentGeneration } from "@plugins/builtin/git/renderer/review/document/generation.ts";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
} from "@plugins/builtin/git/renderer/review/document/limits.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";
import { patchDocument } from "./fixture.ts";

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
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

function document(index: number): GitReviewFileDocumentOk {
  const path = `src/file-${index}.ts`;
  return patchDocument({
    entryKey: `entry:${index}`,
    patch: `diff --git a/${path} b/${path}\n`,
    revision: `document:${index}`,
  });
}

describe("GitReviewDocumentGeneration", () => {
  it("跨代预留额度以 O(1) 聚合指标随 previous 删除而收敛", () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const previousByEntryKey = new Map(
      entries.map((item, index) => [
        item.entryKey,
        {
          document: document(index),
          entry: item,
          kind: "loaded" as const,
        },
      ])
    );
    const selected = entries[2000];
    if (!selected) {
      throw new Error("missing selected entry");
    }
    const controller = new GitReviewDocumentGeneration({
      current: {
        resources: entries.map((item) => ({ entry: item, kind: "idle" })),
        retainedEntryKeys: [],
        settled: false,
      },
      generation: 1,
      previousByEntryKey,
      protectedEntryKey: selected.entryKey,
    });

    expect(controller.retentionLimits()).toEqual({
      maxRetainedBytes: GIT_REVIEW_MAX_RETAINED_BYTES - entries.length * 256,
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES - entries.length,
    });

    const change = controller.apply(
      {
        resources: [
          {
            document: document(2000),
            entry: selected,
            kind: "loaded",
          },
        ],
        settled: false,
      },
      selected.entryKey
    );

    expect(change.changedResources).toHaveLength(1);
    expect(change.failureChanges).toHaveLength(2);
    expect(controller.retentionLimits()).toEqual({
      maxRetainedBytes:
        GIT_REVIEW_MAX_RETAINED_BYTES - (entries.length - 1) * 256,
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES - (entries.length - 1),
    });
  });

  it("没有树选择时也按全部暂留旧正文预留新代加载预算", () => {
    const entries = [entry(0), entry(1)];
    const controller = new GitReviewDocumentGeneration({
      current: {
        resources: entries.map((item) => ({ entry: item, kind: "idle" })),
        retainedEntryKeys: [],
        settled: false,
      },
      generation: 1,
      previousByEntryKey: new Map(
        entries.map((item, index) => [
          item.entryKey,
          {
            document: document(index),
            entry: item,
            kind: "loaded" as const,
          },
        ])
      ),
      protectedEntryKey: null,
    });

    expect(controller.retentionLimits()).toEqual({
      maxRetainedBytes: GIT_REVIEW_MAX_RETAINED_BYTES - entries.length * 256,
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES - entries.length,
    });
  });

  it("每次正文失败只发布对应 entry 的两个来源末态", () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const controller = new GitReviewDocumentGeneration({
      current: {
        resources: entries.map((item) => ({ entry: item, kind: "idle" })),
        retainedEntryKeys: [],
        settled: false,
      },
      generation: 1,
      previousByEntryKey: new Map(),
      protectedEntryKey: null,
    });

    for (const item of entries) {
      const resource = {
        entry: item,
        failure: {
          kind: "error" as const,
          message: item.path,
          reason: "internal" as const,
          retryable: true,
        },
        kind: "error" as const,
      };
      const change = controller.apply(
        { resources: [resource], settled: false },
        null
      );
      expect(change.changedResources).toEqual([resource]);
      expect(change.failureChanges).toEqual([
        {
          entryKey: item.entryKey,
          resource,
          source: "document",
        },
        {
          entryKey: item.entryKey,
          resource: null,
          source: "refresh",
        },
      ]);
    }
  });

  it("跨代 soft retain 在 sectionKey 变化时 remap 到当前 entry", () => {
    const previousEntry = entry(0);
    const stagedEntry: GitReviewIndexEntry = {
      ...previousEntry,
      renderSlots: [
        {
          group: "staged",
          oldPath: null,
          sectionKey: "section:0:staged",
          status: "modified",
          targetPath: previousEntry.path,
        },
      ],
    };
    const previousDoc: GitReviewFileDocumentOk = patchDocument({
      entryKey: previousEntry.entryKey,
      patch: "diff --git a/src/file-0.ts b/src/file-0.ts\n",
      revision: "document:0",
    });
    const controller = new GitReviewDocumentGeneration({
      current: {
        resources: [{ entry: stagedEntry, kind: "idle" }],
        retainedEntryKeys: [],
        settled: false,
      },
      generation: 1,
      previousByEntryKey: new Map([
        [
          previousEntry.entryKey,
          {
            document: previousDoc,
            entry: previousEntry,
            kind: "loaded",
          },
        ],
      ]),
      protectedEntryKey: previousEntry.entryKey,
    });
    const resource = controller
      .snapshot([])
      .resources.find((item) => item.entry.entryKey === previousEntry.entryKey);
    expect(resource?.kind).toBe("loaded");
    if (resource?.kind !== "loaded") {
      throw new Error("expected remapped soft retain");
    }
    expect(resource.entry.renderSlots[0]?.sectionKey).toBe("section:0:staged");
    expect(resource.document).toBe(previousDoc);
    expect(controller.authoritativeEntryKeys()).not.toContain(
      previousEntry.entryKey
    );

    const unchanged = controller.apply(
      {
        resources: [{ entry: stagedEntry, kind: "unchanged" }],
        settled: true,
      },
      previousEntry.entryKey
    );
    expect(controller.authoritativeEntryKeys()).toContain(
      previousEntry.entryKey
    );
    expect(unchanged.staleRetainedCount).toBe(0);
  });

  it("同代 soft budget 回收 idle 时仍保留已 loaded 正文", () => {
    const entries = [entry(0), entry(1)];
    const controller = new GitReviewDocumentGeneration({
      current: {
        resources: entries.map((item) => ({ entry: item, kind: "idle" })),
        retainedEntryKeys: [],
        settled: false,
      },
      generation: 1,
      previousByEntryKey: new Map(),
      protectedEntryKey: null,
    });
    const loaded = {
      document: document(0),
      entry: entries[0]!,
      kind: "loaded" as const,
    };
    expect(
      controller.apply({ resources: [loaded], settled: false }, null)
        .changedResources
    ).toEqual([loaded]);

    const idleAgain = { entry: entries[0]!, kind: "idle" as const };
    const change = controller.apply(
      { resources: [idleAgain], settled: false },
      null
    );
    // 已是 retained loaded 时 apply idle 是 no-op（不重复发 change）。
    expect(change.changedResources).toEqual([]);
    expect(
      controller
        .snapshot([])
        .resources.find(
          (resource) => resource.entry.entryKey === entries[0]!.entryKey
        )
    ).toEqual(loaded);
  });
});
