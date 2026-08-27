import {
  gitReviewConflictCanOpen,
  gitReviewConflictFileActions,
  gitReviewConflictTreeStatus,
} from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";

describe("gitReviewConflictTreeStatus", () => {
  it("maps unmerged XY onto Pierre tree letters", () => {
    expect(gitReviewConflictTreeStatus("UU")).toBe("modified");
    expect(gitReviewConflictTreeStatus("DU")).toBe("deleted");
    expect(gitReviewConflictTreeStatus("UD")).toBe("modified");
    expect(gitReviewConflictTreeStatus("DD")).toBe("deleted");
    expect(gitReviewConflictTreeStatus("AU")).toBe("added");
    expect(gitReviewConflictTreeStatus("UA")).toBe("added");
    expect(gitReviewConflictTreeStatus("AA")).toBe("added");
  });
});

describe("gitReviewConflictFileActions", () => {
  it("puts destructive choices first for modify/delete", () => {
    expect(gitReviewConflictFileActions("DU")).toEqual([
      { action: "ours", destructive: true, intent: "confirm-delete" },
      { action: "theirs", destructive: false, intent: "take-incoming" },
    ]);
    expect(gitReviewConflictFileActions("DD")).toEqual([
      { action: "ours", destructive: true, intent: "confirm-delete" },
    ]);
  });

  it("offers stage last for marker-free UU", () => {
    expect(gitReviewConflictFileActions("UU").at(-1)).toEqual({
      action: "stage",
      destructive: false,
      intent: "stage-current",
    });
  });
});

describe("gitReviewConflictCanOpen", () => {
  it("hides open for worktree-missing paths", () => {
    expect(gitReviewConflictCanOpen("DU")).toBe(false);
    expect(gitReviewConflictCanOpen("DD")).toBe(false);
    expect(gitReviewConflictCanOpen("UD")).toBe(true);
    expect(gitReviewConflictCanOpen("UU")).toBe(true);
  });
});
