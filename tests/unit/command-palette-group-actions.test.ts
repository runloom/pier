import { describe, expect, it } from "vitest";
import type { Action } from "@/lib/actions/types.ts";
import {
  groupActionsForPalette,
  rankActionsForPalette,
} from "@/lib/command-palette/action-search.ts";

const mk = (
  id: string,
  category: string,
  sortOrder?: number,
  title = id,
  aliases: readonly string[] = []
): Action => {
  const action: Action = {
    id,
    category,
    handler: () => undefined,
    surfaces: ["command-palette"],
    title: () => title,
  };
  if (sortOrder != null || aliases.length > 0) {
    action.metadata = {};
    if (sortOrder != null) {
      action.metadata.sortOrder = sortOrder;
    }
    if (aliases.length > 0) {
      action.metadata.aliases = () => aliases;
    }
  }
  return action;
};

describe("groupActionsForPalette", () => {
  it("query 非空 → 按本地搜索相关性全局排序, frecency 只做同分兜底", () => {
    const actions = [
      mk("pier.settings.open", "Settings", 10, "Open Settings"),
      mk("pier.panel.equalizeSplits", "Panel", 1, "Equalize Panels", [
        "balance panels",
      ]),
    ];
    const ranked = rankActionsForPalette(
      actions,
      new Map([["pier.settings.open", 100]]),
      "balance",
      new Map()
    );

    expect(ranked.map((a) => a.id)).toEqual(["pier.panel.equalizeSplits"]);
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

  it("uses metadata category keys for shared plugin actions", () => {
    const action = mk("pier.worktree.create", "Worktree");
    action.metadata = { categoryKey: "worktree" };

    const groups = groupActionsForPalette([action], new Map(), "");

    expect(groups).toMatchObject([
      {
        actions: [{ id: "pier.worktree.create" }],
        category: "worktree",
      },
    ]);
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
