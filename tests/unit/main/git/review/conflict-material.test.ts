import {
  classifyConflictWorktreePresentation,
  hasCompleteMergeConflictMarkers,
} from "@main/services/git-review/document/conflict.ts";
import { describe, expect, it } from "vitest";

describe("classifyConflictWorktreePresentation", () => {
  it("keeps complete marker stacks on UnresolvedFile", () => {
    expect(
      classifyConflictWorktreePresentation(
        ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> other"].join(
          "\n"
        )
      )
    ).toBe("markers-text");
  });

  it("does not feed marker-free text to UnresolvedFile", () => {
    expect(classifyConflictWorktreePresentation("resolved\n")).toBe(
      "file-level"
    );
    expect(classifyConflictWorktreePresentation("")).toBe("file-level");
  });

  it("downgrades incomplete marker stacks to file-level", () => {
    expect(
      classifyConflictWorktreePresentation(
        ["<<<<<<< HEAD", "ours", "=======", "theirs"].join("\n")
      )
    ).toBe("file-level");
  });
});

describe("hasCompleteMergeConflictMarkers", () => {
  it("accepts a standard two-way conflict", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        [
          "line",
          "<<<<<<< HEAD",
          "ours",
          "=======",
          "theirs",
          ">>>>>>> other",
          "",
        ].join("\n")
      )
    ).toBe(true);
  });

  it("accepts diff3 base markers", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        [
          "<<<<<<< HEAD",
          "ours",
          "||||||| base",
          "base",
          "=======",
          "theirs",
          ">>>>>>> other",
          "",
        ].join("\n")
      )
    ).toBe(true);
  });

  it("rejects unfinished marker stacks", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        ["<<<<<<< HEAD", "ours", "=======", "theirs"].join("\n")
      )
    ).toBe(false);
  });

  it("rejects text without markers", () => {
    expect(hasCompleteMergeConflictMarkers("just text\n")).toBe(false);
  });

  it("accepts multiple sequential regions", () => {
    const text = [
      "<<<<<<< HEAD",
      "a1",
      "=======",
      "b1",
      ">>>>>>> one",
      "middle",
      "<<<<<<< HEAD",
      "a2",
      "=======",
      "b2",
      ">>>>>>> two",
      "",
    ].join("\n");
    expect(hasCompleteMergeConflictMarkers(text)).toBe(true);
  });
});
