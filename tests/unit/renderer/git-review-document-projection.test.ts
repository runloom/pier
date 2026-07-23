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
      t: vi.fn((key: string, _values?: unknown, fallback?: string) =>
        typeof fallback === "string" ? fallback : key
      ),
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

  it("orders projected items conflict, staged, unstaged then path", () => {
    const mixed = (partial: {
      path: string;
      entryKey: string;
      slots: Array<{
        group: "conflict" | "unstaged" | "staged" | "committed";
        sectionKey: string;
      }>;
    }): GitReviewDocumentResource => ({
      entry: {
        entryKey: partial.entryKey,
        oldPaths: [],
        path: partial.path,
        renderSlots: partial.slots.map((slot) => ({
          group: slot.group,
          oldPath: null,
          sectionKey: slot.sectionKey,
          status: slot.group === "conflict" ? "conflicted" : "modified",
          targetPath: partial.path,
        })),
        status: "modified",
      },
      kind: "idle",
    });
    const projection = projectReviewDocuments(
      {
        resources: [
          mixed({
            entryKey: "entry:b",
            path: "b.ts",
            slots: [
              { group: "staged", sectionKey: "sec:s:b" },
              { group: "unstaged", sectionKey: "sec:u:b" },
            ],
          }),
          mixed({
            entryKey: "entry:a",
            path: "a.ts",
            slots: [
              { group: "conflict", sectionKey: "sec:c:a" },
              { group: "unstaged", sectionKey: "sec:u:a" },
              { group: "staged", sectionKey: "sec:s:a" },
            ],
          }),
          mixed({
            entryKey: "entry:z",
            path: "z.ts",
            slots: [{ group: "committed", sectionKey: "sec:m:z" }],
          }),
        ],
        retainedEntryKeys: [],
        settled: false,
      },
      context(),
      "en"
    );
    expect(projection.items.map((item) => item.id)).toEqual([
      "sec:c:a",
      "sec:s:a",
      "sec:s:b",
      "sec:u:a",
      "sec:u:b",
      "sec:m:z",
    ]);
    // Half-staged path appears twice; stageControl distinguishes groups.
    const stagedA = projection.items.find((item) => item.id === "sec:s:a");
    const unstagedA = projection.items.find((item) => item.id === "sec:u:a");
    expect(stagedA?.fileDisplay?.path).toBe("a.ts");
    expect(unstagedA?.fileDisplay?.path).toBe("a.ts");
    expect(stagedA?.stageControl).toEqual({ state: "staged" });
    expect(unstagedA?.stageControl).toEqual({
      canDiscard: true,
      state: "unstaged",
    });
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
