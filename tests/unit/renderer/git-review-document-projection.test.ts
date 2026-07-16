import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it, vi } from "vitest";
import {
  indexReviewDocumentProjection,
  indexReviewEntrySections,
  projectReviewDocuments,
} from "../../../src/plugins/builtin/git/renderer/git-review-document-projection.ts";
import type { GitReviewDocumentResource } from "../../../src/plugins/builtin/git/renderer/git-review-document-resource.ts";

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

function loaded(index: number): GitReviewDocumentResource {
  const item = entry(index);
  const document: GitReviewFileDocumentOk = {
    kind: "ok",
    revision: `document:${index}`,
    sections: [
      {
        kind: "patch",
        patch: `diff --git a/${item.path} b/${item.path}\n@@ -1 +1 @@\n-old\n+new\n`,
        sectionKey: `section:${index}`,
      },
    ],
  };
  return { document, entry: item, kind: "loaded" };
}

function context(): RendererPluginContext {
  return {
    i18n: {
      t: vi.fn((key: string, fallback?: string) => fallback ?? key),
    },
  } as never;
}

describe("projectReviewDocuments gold-standard slots", () => {
  it("projects every index entry as a stable CodeView item including idle placeholders", () => {
    const resources: GitReviewDocumentResource[] = [
      { entry: entry(0), kind: "idle" },
      { entry: entry(1), kind: "loading", operationId: "op-1" },
      loaded(2),
      {
        entry: entry(3),
        failure: {
          kind: "error",
          message: "boom",
          reason: "internal",
          retryable: true,
        },
        kind: "error",
      },
      { entry: entry(4), kind: "unchanged" },
    ];
    const projection = projectReviewDocuments(
      {
        resources,
        retainedEntryKeys: [],
        settled: false,
      },
      context(),
      "en"
    );

    expect(projection.items.map((item) => item.id)).toEqual([
      "section:0",
      "section:1",
      "section:2",
      "section:3",
      "section:4",
    ]);
    expect(projection.items[0]?.cacheKey).toBe(
      "git-review-placeholder:section:0"
    );
    expect(projection.items[1]?.cacheKey).toBe(
      "git-review-placeholder:section:1"
    );
    expect(projection.items[2]?.patch).toContain("+new");
    expect([...projection.entryKeyBySectionId.keys()]).toEqual([
      "section:0",
      "section:1",
      "section:2",
      "section:3",
      "section:4",
    ]);
  });
});

describe("indexReviewEntrySections", () => {
  it("indexes first section from full entries independent of item index", () => {
    const entries = [entry(0), entry(1), entry(2)];
    expect([...indexReviewEntrySections(entries).entries()]).toEqual([
      ["entry:0", "section:0"],
      ["entry:1", "section:1"],
      ["entry:2", "section:2"],
    ]);
    const projection = projectReviewDocuments(
      {
        resources: entries.map((item) => ({
          entry: item,
          kind: "idle" as const,
        })),
        retainedEntryKeys: [],
        settled: false,
      },
      context(),
      "en"
    );
    const itemIndex = indexReviewDocumentProjection(projection);
    expect(itemIndex.itemIds).toEqual(["section:0", "section:1", "section:2"]);
    expect(itemIndex).not.toHaveProperty("firstSectionIdByEntryKey");
  });
});
