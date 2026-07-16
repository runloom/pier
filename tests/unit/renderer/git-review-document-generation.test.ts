import { GitReviewDocumentGeneration } from "@plugins/builtin/git/renderer/git-review-document-generation.ts";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
} from "@plugins/builtin/git/renderer/git-review-document-limits.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it } from "vitest";

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
  return {
    kind: "ok",
    revision: `document:${index}`,
    sections: [],
  };
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
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES,
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
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES,
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
      maxRetainedLines: GIT_REVIEW_MAX_RETAINED_LINES,
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
