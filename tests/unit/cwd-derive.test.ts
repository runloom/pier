import { describe, expect, it } from "vitest";
import { resolveLong } from "@/components/common/document-title.tsx";

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
