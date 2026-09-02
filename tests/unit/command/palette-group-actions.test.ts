import { describe, expect, it } from "vitest";
import type { Action } from "@/lib/actions/types.ts";
import { rankActionsForPalette } from "@/lib/command-palette/action-search.ts";

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

describe("rankActionsForPalette", () => {
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
});
