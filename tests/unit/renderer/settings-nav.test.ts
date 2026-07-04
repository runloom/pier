import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/pages/settings/data/appearance-nav.ts";

describe("settings navigation metadata", () => {
  it("不在导航配置里保存静态文案，且 Worktree 不再是顶层静态分区", () => {
    expect(NAV_ITEMS.some((item) => "label" in item)).toBe(false);
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("worktree");
  });
});
