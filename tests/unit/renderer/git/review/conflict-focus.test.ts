import { describe, expect, it } from "vitest";
import {
  focusConflictItems,
  isConflictOnlyBody,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/conflict-focus.ts";

function item(
  id: string,
  kind: "conflict" | "estimate" | "loaded" = "conflict"
) {
  return {
    cacheKey: id,
    id,
    kind,
    patch: kind === "loaded" ? "diff" : null,
  };
}

describe("focusConflictItems", () => {
  it("returns the selected conflict item only", () => {
    expect(
      focusConflictItems([item("a"), item("b")], "b").map((row) => row.id)
    ).toEqual(["b"]);
  });

  it("falls back to the first conflict item when nothing is selected", () => {
    expect(
      focusConflictItems([item("a"), item("b")], null).map((row) => row.id)
    ).toEqual(["a"]);
  });

  it("ignores CodeView items", () => {
    expect(
      focusConflictItems(
        [item("diff", "loaded"), item("a"), item("b")],
        "b"
      ).map((row) => row.id)
    ).toEqual(["b"]);
  });
});

describe("isConflictOnlyBody", () => {
  it("does not key off the active reading-surface name", () => {
    expect(isConflictOnlyBody(0, 3)).toBe(false);
    expect(isConflictOnlyBody(1, 3)).toBe(false);
    expect(isConflictOnlyBody(1, 0)).toBe(true);
    expect(isConflictOnlyBody(0, 0)).toBe(false);
  });
});
