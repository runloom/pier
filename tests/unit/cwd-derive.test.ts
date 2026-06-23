import { describe, expect, it } from "vitest";
import { resolveLong } from "@/components/common/document-title.tsx";
import { basename } from "@/panel-kits/terminal/terminal-panel.tsx";

describe("basename", () => {
  it('handles "/" root', () => {
    expect(basename("/")).toBe("/");
  });
  it("strips trailing slash", () => {
    expect(basename("/a/b/")).toBe("b");
  });
  it("returns last segment", () => {
    expect(basename("/Users/x/ABC/pier")).toBe("pier");
  });
  it("returns input when no slash", () => {
    expect(basename("pier")).toBe("pier");
  });
  it('fallback "Terminal" for empty input', () => {
    expect(basename("")).toBe("Terminal");
  });
});

describe("resolveLong", () => {
  it("prefers long over path (long 是 panel 主动计算的权威值)", () => {
    expect(
      resolveLong({
        short: "pier",
        long: "Claude Code",
        path: "/Users/x/pier",
      })
    ).toBe("Claude Code");
  });

  it("falls back to path when no long", () => {
    expect(resolveLong({ short: "x", path: "/tmp/abc" })).toBe("/tmp/abc");
  });

  it("falls back to short when neither long nor path", () => {
    expect(resolveLong({ short: "x" })).toBe("x");
  });

  it("OSC sequenceTitle 在 long 里时优先于真实 cwd path", () => {
    // 模拟 terminal-panel 真实输入:long=sequenceTitle, path=cwd
    expect(
      resolveLong({
        short: "pier",
        long: "Claude Code",
        path: "/Users/x/ABC/pier",
      })
    ).toBe("Claude Code");
  });
});
