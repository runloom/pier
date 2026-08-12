import {
  __applyConflictResolutionForTest,
  __countUnresolvedMarkersForTest,
} from "@pier/ui/diff-view/unresolved-conflict/index.tsx";
import { describe, expect, it } from "vitest";

const multiRegion = [
  "pre\n",
  "<<<<<<< HEAD\n",
  "ours-a\n",
  "=======\n",
  "theirs-a\n",
  ">>>>>>> other\n",
  "mid\n",
  "<<<<<<< HEAD\n",
  "ours-b\n",
  "=======\n",
  "theirs-b\n",
  ">>>>>>> other\n",
  "post\n",
].join("");

describe("conflict Accept rebuild", () => {
  it("counts unresolved start markers", () => {
    expect(__countUnresolvedMarkersForTest(multiRegion)).toBe(2);
    expect(__countUnresolvedMarkersForTest("clean\n")).toBe(0);
  });

  it("applies sequential Accepts across two regions", () => {
    // Indices match line list from splitPreserveNewlines (newline kept on lines).
    const region0 = {
      conflictIndex: 0,
      endLineIndex: 5,
      separatorLineIndex: 3,
      startLineIndex: 1,
    };
    const afterFirst = __applyConflictResolutionForTest(
      multiRegion,
      region0,
      "current"
    );
    expect(afterFirst).toBe(
      [
        "pre\n",
        "ours-a\n",
        "mid\n",
        "<<<<<<< HEAD\n",
        "ours-b\n",
        "=======\n",
        "theirs-b\n",
        ">>>>>>> other\n",
        "post\n",
      ].join("")
    );
    expect(__countUnresolvedMarkersForTest(afterFirst)).toBe(1);

    // Second region shifts up after first Accept (start was 7, removed 4 lines → 3).
    const region1 = {
      conflictIndex: 0,
      endLineIndex: 7,
      separatorLineIndex: 5,
      startLineIndex: 3,
    };
    const afterSecond = __applyConflictResolutionForTest(
      afterFirst,
      region1,
      "incoming"
    );
    expect(afterSecond).toBe(
      ["pre\n", "ours-a\n", "mid\n", "theirs-b\n", "post\n"].join("")
    );
    expect(__countUnresolvedMarkersForTest(afterSecond)).toBe(0);
  });

  it("accept both concatenates current then incoming", () => {
    const body = [
      "<<<<<<< HEAD\n",
      "a\n",
      "=======\n",
      "b\n",
      ">>>>>>> other\n",
    ].join("");
    const resolved = __applyConflictResolutionForTest(
      body,
      {
        conflictIndex: 0,
        endLineIndex: 4,
        separatorLineIndex: 2,
        startLineIndex: 0,
      },
      "both"
    );
    expect(resolved).toBe("a\nb\n");
  });
});
