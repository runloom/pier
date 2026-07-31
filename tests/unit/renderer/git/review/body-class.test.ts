import { describe, expect, it } from "vitest";
import {
  classifyReviewSlotBodyClass,
  isReviewEntryBodyHydratable,
  isReviewSlotIncludedInBody,
  reviewContentEntryKeysInOrder,
  reviewEntryHasBodyContent,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/body-class.ts";
import type { GitReviewIndexEntry } from "../../../../../src/shared/contracts/git/review.ts";

function slot(
  partial: Partial<GitReviewIndexEntry["renderSlots"][number]> & {
    readonly status: GitReviewIndexEntry["renderSlots"][number]["status"];
  }
): GitReviewIndexEntry["renderSlots"][number] {
  return {
    additions: partial.additions,
    binary: partial.binary,
    deletions: partial.deletions,
    group: partial.group ?? "unstaged",
    oldPath: partial.oldPath ?? null,
    sectionKey: partial.sectionKey ?? "section:1",
    status: partial.status,
    targetPath: partial.targetPath ?? "a.ts",
  };
}

describe("classifyReviewSlotBodyClass (gold standard)", () => {
  it("marks pure rename and empty as meta", () => {
    expect(
      classifyReviewSlotBodyClass(
        slot({ additions: 0, deletions: 0, status: "renamed" })
      )
    ).toBe("meta");
    expect(
      classifyReviewSlotBodyClass(
        slot({ additions: 0, deletions: 0, status: "modified" })
      )
    ).toBe("meta");
  });

  it("marks binary as notice and text changes as content", () => {
    expect(
      classifyReviewSlotBodyClass(slot({ binary: true, status: "modified" }))
    ).toBe("notice");
    expect(
      classifyReviewSlotBodyClass(
        slot({ additions: 3, deletions: 1, status: "renamed" })
      )
    ).toBe("content");
  });

  it("includes only content in body membership by default", () => {
    expect(
      isReviewSlotIncludedInBody(
        slot({ additions: 0, deletions: 0, status: "renamed" })
      )
    ).toBe(false);
    expect(
      isReviewSlotIncludedInBody(
        slot({ additions: 1, deletions: 0, status: "modified" })
      )
    ).toBe(true);
  });
});

describe("reviewContentEntryKeysInOrder", () => {
  it("drops pure-rename-only entries from hydrate order", () => {
    const renameOnly: GitReviewIndexEntry = {
      entryKey: "entry:rename",
      oldPaths: ["old.ts"],
      path: "new.ts",
      renderSlots: [
        slot({
          additions: 0,
          deletions: 0,
          oldPath: "old.ts",
          sectionKey: "s:rename",
          status: "renamed",
          targetPath: "new.ts",
        }),
      ],
      status: "renamed",
    };
    const modified: GitReviewIndexEntry = {
      entryKey: "entry:mod",
      oldPaths: [],
      path: "m.ts",
      renderSlots: [
        slot({
          additions: 2,
          deletions: 1,
          sectionKey: "s:mod",
          status: "modified",
          targetPath: "m.ts",
        }),
      ],
      status: "modified",
    };
    expect(isReviewEntryBodyHydratable(renameOnly)).toBe(false);
    expect(isReviewEntryBodyHydratable(modified)).toBe(true);
    expect(reviewContentEntryKeysInOrder([renameOnly, modified])).toEqual([
      "entry:mod",
    ]);
    expect(reviewEntryHasBodyContent(renameOnly)).toBe(false);
  });
});
