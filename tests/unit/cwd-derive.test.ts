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
  it("prefers path over long", () => {
    expect(
      resolveLong({
        short: "pier",
        long: "Pier project",
        path: "/Users/x/pier",
      })
    ).toBe("/Users/x/pier");
  });

  it("falls back to long when no path", () => {
    expect(resolveLong({ short: "x", long: "long text" })).toBe("long text");
  });

  it("falls back to short when neither path nor long", () => {
    expect(resolveLong({ short: "x" })).toBe("x");
  });
});
