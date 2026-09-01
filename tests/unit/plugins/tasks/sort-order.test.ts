import { describe, expect, it } from "vitest";
import {
  largestIndexMove,
  placeCardInColumn,
  rankBetween,
} from "../../../../packages/plugin-tasks/applets/tracker-board/sort-order.ts";

describe("board drop rank", () => {
  it("inserts between neighbors instead of appending", () => {
    const placed = placeCardInColumn(
      [
        { key: "a", sortOrder: 100, title: "A" },
        { key: "c", sortOrder: 300, title: "C" },
      ],
      { key: "b", title: "B" },
      1
    );
    expect(placed.items.map((item) => item.key)).toEqual(["a", "b", "c"]);
    expect(placed.sortOrder).toBe(200);
    expect(placed.rankAfterKey).toBe("a");
    expect(placed.rankBeforeKey).toBe("c");
  });

  it("ranks before the first card and after the last", () => {
    expect(rankBetween(undefined, 100)).toBe(-900);
    expect(rankBetween(100, undefined)).toBe(1100);
  });

  it("does not persist a numeric rank that would jump past equal neighbors", () => {
    const placed = placeCardInColumn(
      [
        { key: "a", sortOrder: 1 },
        { key: "c", sortOrder: 1 },
      ],
      { key: "b" },
      1
    );
    expect(placed.items.map((item) => item.key)).toEqual(["a", "b", "c"]);
    expect(placed.persistSortOrder).toBe(false);
    expect(placed.sortOrder).toBe(1.001);
  });

  it("finds the card that moved the farthest in a same-column reorder", () => {
    expect(
      largestIndexMove(["a", "b", "c", "d"], ["a", "d", "b", "c"])
    ).toEqual({ index: 1, key: "d" });
  });

  it("reconstructs the preview order from the largest move", () => {
    const items = [
      { key: "a", sortOrder: 1 },
      { key: "b", sortOrder: 2 },
      { key: "c", sortOrder: 3 },
      { key: "d", sortOrder: 4 },
    ];
    const next = ["a", "d", "b", "c"];
    const moved = largestIndexMove(
      items.map((item) => item.key),
      next
    );
    const card = items.find((item) => item.key === "d");
    expect(moved).toEqual({ index: 1, key: "d" });
    expect(card).toBeDefined();
    if (!card) {
      return;
    }
    const placed = placeCardInColumn(items, card, moved?.index);
    expect(placed.items.map((item) => item.key)).toEqual(next);
    expect(placed.sortOrder).toBe(1.5);
  });
});
