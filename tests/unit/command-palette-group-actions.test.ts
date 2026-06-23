import { describe, expect, it } from "vitest";
import { groupActionsForPalette } from "@/components/common/command-palette.tsx";
import type { Action } from "@/lib/actions/types.ts";

const mk = (id: string, category: string, sortOrder?: number): Action => ({
  id,
  category,
  title: () => id,
  handler: () => undefined,
  surfaces: ["command-palette"],
  ...(sortOrder == null ? {} : { metadata: { sortOrder } }),
});

describe("groupActionsForPalette", () => {
  it("query 非空 → 按 CATEGORY_META.order 排, 组内保持入参顺序", () => {
    const actions = [
      mk("s1", "Settings", 10),
      mk("v1", "View", 5),
      mk("v2", "View", 1),
    ];
    const groups = groupActionsForPalette(actions, new Map(), "foo");
    expect(groups.map((g) => g.category)).toEqual(["View", "Settings"]);
    expect(groups[0]?.actions.map((a) => a.id)).toEqual(["v1", "v2"]);
  });

  it("query 空 + 全无 frecency → 等同 CATEGORY_META.order + sortOrder", () => {
    const actions = [
      mk("v1", "View", 5),
      mk("v2", "View", 1),
      mk("s1", "Settings", 10),
    ];
    const groups = groupActionsForPalette(actions, new Map(), "");
    expect(groups.map((g) => g.category)).toEqual(["View", "Settings"]);
    expect(groups[0]?.actions.map((a) => a.id)).toEqual(["v2", "v1"]);
  });

  it("query 空 + 有 frecency → 组间按 max(score) 排, 组内按 score 排", () => {
    const actions = [
      mk("v1", "View"),
      mk("v2", "View"),
      mk("s1", "Settings"),
      mk("s2", "Settings"),
    ];
    const map = new Map([
      ["v1", 3],
      ["s1", 10],
      ["s2", 7],
    ]);
    const groups = groupActionsForPalette(actions, map, "");
    expect(groups[0]?.category).toBe("Settings");
    expect(groups[0]?.actions.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(groups[1]?.category).toBe("View");
    expect(groups[1]?.actions.map((a) => a.id)).toEqual(["v1", "v2"]);
  });

  it("frecency tier 整组排在 fallback tier 整组之前", () => {
    const actions = [mk("v1", "View", 5), mk("p1", "Panel")];
    const map = new Map([["p1", 1]]);
    const groups = groupActionsForPalette(actions, map, "");
    expect(groups.map((g) => g.category)).toEqual(["Panel", "View"]);
  });
});
