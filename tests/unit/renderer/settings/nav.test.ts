import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/pages/settings/data/appearance-nav.ts";

describe("settings navigation metadata", () => {
  it("不在导航配置里保存静态文案，且 Worktree 不再是顶层静态分区", () => {
    expect(NAV_ITEMS.some((item) => "label" in item)).toBe(false);
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("worktree");
  });

  it("workspace(宿主级工作区偏好)是顶层静态分区", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toContain("workspace");
  });

  it("projects is the top-level settings section for environment + skills", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toContain("projects");
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("environment");
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("skills");
  });

  it("workspace sits immediately after projects, before plugins", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      "appearance",
      "terminal",
      "keybindings",
      "agents",
      "notifications",
      "projects",
      "workspace",
      "plugins",
      "updates",
    ]);
  });
});
