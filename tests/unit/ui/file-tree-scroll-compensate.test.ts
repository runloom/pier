import {
  isBeforeInTreeOrder,
  shouldCompensateScroll,
} from "@pier/ui/file/tree-scroll-compensate.ts";
import { describe, expect, it } from "vitest";

const anchorSnapshot = {
  fallbackScrollTop: 200,
  kind: "anchor" as const,
  path: "src/anchor.ts",
  topOffset: 24,
};

describe("isBeforeInTreeOrder", () => {
  it("orders siblings lexicographically", () => {
    expect(isBeforeInTreeOrder("src/a.ts", "src/b.ts")).toBe(true);
    expect(isBeforeInTreeOrder("src/b.ts", "src/a.ts")).toBe(false);
  });

  it("orders ancestors before descendants", () => {
    expect(isBeforeInTreeOrder("src", "src/a.ts")).toBe(true);
    expect(isBeforeInTreeOrder("src/a.ts", "src")).toBe(false);
  });
});

describe("shouldCompensateScroll", () => {
  it("skips when user is scrolling or reveal is active", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/inserted.ts", type: "add" }],
        snapshot: anchorSnapshot,
        userScrolling: true,
      })
    ).toBe(false);
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/inserted.ts", type: "add" }],
        snapshot: anchorSnapshot,
        revealActive: true,
      })
    ).toBe(false);
  });

  it("skips null snapshot and empty mutation", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/a.ts", type: "add" }],
        snapshot: null,
      })
    ).toBe(false);
    expect(
      shouldCompensateScroll({
        mutation: [],
        snapshot: anchorSnapshot,
      })
    ).toBe(false);
  });

  it("compensates inserts above the anchor", () => {
    expect(
      shouldCompensateScroll({
        mutation: [
          { path: "src/000-insert-a.ts", type: "add" },
          { path: "src/000-insert-b.ts", type: "add" },
        ],
        snapshot: anchorSnapshot,
      })
    ).toBe(true);
  });

  it("skips inserts strictly below the anchor", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/below.ts", type: "add" }],
        snapshot: anchorSnapshot,
      })
    ).toBe(false);
  });

  it("skips adds under the anchor path (children below the row)", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/anchor.ts/child.ts", type: "add" }],
        snapshot: {
          ...anchorSnapshot,
          path: "src/anchor.ts",
        },
      })
    ).toBe(false);
  });

  it("compensates remove/move that affects above the anchor", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "src/above.ts", type: "remove" }],
        snapshot: anchorSnapshot,
      })
    ).toBe(true);
    expect(
      shouldCompensateScroll({
        mutation: [
          { from: "src/000-old.ts", to: "src/000-renamed.ts", type: "move" },
        ],
        snapshot: anchorSnapshot,
      })
    ).toBe(true);
  });

  it("skips search materialize adds unless resetPaths", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "deep/match.ts", type: "add" }],
        snapshot: anchorSnapshot,
        searchActive: true,
      })
    ).toBe(false);
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "deep/match.ts", type: "add" }],
        snapshot: anchorSnapshot,
        searchActive: true,
        usedResetPaths: true,
      })
    ).toBe(true);
  });

  it("always compensates resetPaths when allowed", () => {
    expect(
      shouldCompensateScroll({
        mutation: [],
        snapshot: { fallbackScrollTop: 80, kind: "position" },
        usedResetPaths: true,
      })
    ).toBe(true);
  });

  it("position snapshot only compensates shrink/move risk", () => {
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "z.ts", type: "add" }],
        snapshot: { fallbackScrollTop: 80, kind: "position" },
      })
    ).toBe(false);
    expect(
      shouldCompensateScroll({
        mutation: [{ path: "a.ts", type: "remove" }],
        snapshot: { fallbackScrollTop: 80, kind: "position" },
      })
    ).toBe(true);
  });
});
