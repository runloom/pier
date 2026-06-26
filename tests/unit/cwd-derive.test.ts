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
  it("prefers display.long over display.short", () => {
    expect(
      resolveLong({
        display: {
          long: "Claude Code",
          short: "pier",
        },
      })
    ).toBe("Claude Code");
  });

  it("falls back to display.short when no long", () => {
    expect(resolveLong({ display: { short: "x" } })).toBe("x");
  });

  it("OSC sequenceTitle 在 display.long 里时优先显示", () => {
    expect(
      resolveLong({
        display: {
          long: "Claude Code",
          short: "pier",
        },
      })
    ).toBe("Claude Code");
  });
});
