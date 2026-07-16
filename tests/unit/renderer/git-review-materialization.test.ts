import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { describe, expect, it } from "vitest";
import type { GitReviewDocumentResource } from "../../../src/plugins/builtin/git/renderer/git-review-document-resource.ts";
import {
  isMaterializedReviewResource,
  nextMaterializedEntryKeys,
} from "../../../src/plugins/builtin/git/renderer/git-review-materialization.ts";

function entry(index: number): GitReviewIndexEntry {
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path: `src/file-${index}.ts`,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: `src/file-${index}.ts`,
      },
    ],
    status: "modified",
  };
}

function resource(
  index: number,
  kind: GitReviewDocumentResource["kind"]
): GitReviewDocumentResource {
  if (kind === "loaded") {
    return {
      document: {
        kind: "ok",
        revision: `document:${index}`,
        sections: [],
      },
      entry: entry(index),
      kind,
    };
  }
  if (kind === "loading" || kind === "cancelling") {
    return { entry: entry(index), kind, operationId: "op" };
  }
  if (kind === "error") {
    return {
      entry: entry(index),
      failure: {
        kind: "error",
        message: "x",
        reason: "internal",
        retryable: true,
      },
      kind,
    };
  }
  return { entry: entry(index), kind };
}

function resourceMap(
  items: readonly GitReviewDocumentResource[]
): Map<string, GitReviewDocumentResource> {
  return new Map(items.map((item) => [item.entry.entryKey, item]));
}

describe("nextMaterializedEntryKeys", () => {
  it("adds non-idle resources and keeps sticky idle only while demanded/selected/retained", () => {
    const keys = ["entry:0", "entry:1", "entry:2", "entry:3"];
    const first = nextMaterializedEntryKeys({
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:0", "entry:1"],
      },
      entryKeysInOrder: keys,
      previous: new Set(),
      retainedEntryKeys: new Set(),
      resourceByEntryKey: resourceMap([
        resource(0, "loading"),
        resource(1, "loaded"),
        resource(2, "idle"),
        resource(3, "idle"),
      ]),
      selectedEntryKey: null,
    });
    expect(first).toEqual(["entry:0", "entry:1"]);

    const reclaimed = nextMaterializedEntryKeys({
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:1"],
      },
      entryKeysInOrder: keys,
      previous: new Set(first),
      retainedEntryKeys: new Set(),
      resourceByEntryKey: resourceMap([
        resource(0, "idle"),
        resource(1, "loaded"),
        resource(2, "idle"),
        resource(3, "idle"),
      ]),
      selectedEntryKey: null,
    });
    expect(reclaimed).toEqual(["entry:1"]);

    const protectedSelected = nextMaterializedEntryKeys({
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: [],
      },
      entryKeysInOrder: keys,
      previous: new Set(["entry:2"]),
      retainedEntryKeys: new Set(),
      resourceByEntryKey: resourceMap([
        resource(0, "idle"),
        resource(1, "idle"),
        resource(2, "idle"),
        resource(3, "idle"),
      ]),
      selectedEntryKey: "entry:2",
    });
    expect(protectedSelected).toEqual(["entry:2"]);
  });

  it("blocks reclaim while navigation is pending", () => {
    expect(
      nextMaterializedEntryKeys({
        allowReclaim: false,
        demand: {
          bufferedEntryKeys: [],
          visibleEntryKeys: ["entry:1"],
        },
        entryKeysInOrder: ["entry:0", "entry:1"],
        previous: new Set(["entry:0", "entry:1"]),
        retainedEntryKeys: new Set(),
        resourceByEntryKey: resourceMap([
          resource(0, "idle"),
          resource(1, "loaded"),
        ]),
        selectedEntryKey: "entry:1",
      })
    ).toEqual(["entry:0", "entry:1"]);
  });

  it("drops entries that leave the current index", () => {
    expect(
      nextMaterializedEntryKeys({
        demand: {
          bufferedEntryKeys: [],
          visibleEntryKeys: [],
        },
        entryKeysInOrder: ["entry:1"],
        previous: new Set(["entry:0", "entry:1"]),
        retainedEntryKeys: new Set(["entry:0"]),
        resourceByEntryKey: resourceMap([resource(1, "loaded")]),
        selectedEntryKey: "entry:0",
      })
    ).toEqual(["entry:1"]);
  });
});

describe("isMaterializedReviewResource", () => {
  it("treats only idle as non-materialized", () => {
    expect(isMaterializedReviewResource(resource(0, "idle"))).toBe(false);
    expect(isMaterializedReviewResource(resource(0, "loading"))).toBe(true);
    expect(isMaterializedReviewResource(resource(0, "loaded"))).toBe(true);
    expect(isMaterializedReviewResource(resource(0, "error"))).toBe(true);
    expect(isMaterializedReviewResource(resource(0, "unchanged"))).toBe(true);
    expect(isMaterializedReviewResource(resource(0, "cancelling"))).toBe(true);
  });
});
