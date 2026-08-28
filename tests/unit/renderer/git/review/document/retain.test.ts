import { describe, expect, it } from "vitest";
import { retainLoadedDocumentForEntry } from "../../../../../../src/plugins/builtin/git/renderer/review/document/loader-utils.ts";
import type { GitReviewIndexEntry } from "../../../../../../src/shared/contracts/git/review.ts";
import { patchDocument } from "./fixture.ts";

function makeEntry(
  slots: readonly {
    group: "staged" | "unstaged";
    sectionKey: string;
    targetPath?: string;
  }[]
): GitReviewIndexEntry {
  const path = slots[0]?.targetPath ?? "src/a.ts";
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: slots.map((slot) => ({
      group: slot.group,
      oldPath: null,
      sectionKey: slot.sectionKey,
      status: "modified" as const,
      targetPath: slot.targetPath ?? path,
    })),
    status: "modified",
  };
}

describe("canonical document retention", () => {
  it("retains the same document across stage-group migration", () => {
    const entry = makeEntry([{ group: "staged", sectionKey: "key-staged" }]);
    const doc = patchDocument({
      entryKey: entry.entryKey,
      patch: "diff --git a/src/a.ts b/src/a.ts\n",
    });
    expect(retainLoadedDocumentForEntry(entry, doc)?.document).toBe(doc);
  });

  it("does not duplicate the document when a file becomes partially staged", () => {
    const entry = makeEntry([
      { group: "staged", sectionKey: "key-staged" },
      { group: "unstaged", sectionKey: "key-unstaged" },
    ]);
    const doc = patchDocument({
      entryKey: entry.entryKey,
      patch: "diff --git a/src/a.ts b/src/a.ts\n",
    });
    const retained = retainLoadedDocumentForEntry(entry, doc);
    expect(retained?.document).toBe(doc);
    expect(retained?.document.entryKey).toBe(entry.entryKey);
  });

  it("rejects a cached document owned by another entry", () => {
    const entry = makeEntry([{ group: "unstaged", sectionKey: "key" }]);
    const doc = patchDocument({
      entryKey: "entry:other",
      patch: "diff --git a/src/a.ts b/src/a.ts\n",
    });
    expect(retainLoadedDocumentForEntry(entry, doc)).toBeNull();
  });

  it("retains a matching document without changing its revision", () => {
    const entry = makeEntry([
      { group: "staged", sectionKey: "key-staged" },
      { group: "unstaged", sectionKey: "key-unstaged" },
    ]);
    const doc = patchDocument({
      entryKey: entry.entryKey,
      patch: "diff --git a/src/a.ts b/src/a.ts\n",
      revision: "rev-1",
    });
    const retained = retainLoadedDocumentForEntry(entry, doc);
    expect(retained?.kind).toBe("loaded");
    expect(retained?.document).toBe(doc);
    expect(retained?.document.revision).toBe("rev-1");
  });
});
