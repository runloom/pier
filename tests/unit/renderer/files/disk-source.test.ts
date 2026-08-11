import { describe, expect, it } from "vitest";
import {
  normalizeFilesDiskPath,
  normalizeFilesDiskRoot,
  parseFilesDiskSourceFromParams,
  sameFilesDiskSource,
} from "@/lib/files/disk-source.ts";

describe("normalizeFilesDiskRoot / path", () => {
  it("normalizes separators and trailing slashes", () => {
    expect(normalizeFilesDiskRoot("/Users/a/pier/")).toBe("/Users/a/pier");
    expect(normalizeFilesDiskRoot("C:\\repo\\")).toBe("C:/repo");
    expect(normalizeFilesDiskPath("src\\foo.ts")).toBe("src/foo.ts");
    expect(normalizeFilesDiskPath("/src/foo.ts/")).toBe("src/foo.ts");
  });
});

describe("parseFilesDiskSourceFromParams", () => {
  it("returns normalized disk source", () => {
    expect(
      parseFilesDiskSourceFromParams({
        source: {
          kind: "disk",
          path: "src\\README.md",
          root: "/Users/a/pier/",
        },
      })
    ).toEqual({
      kind: "disk",
      path: "src/README.md",
      root: "/Users/a/pier",
    });
  });

  it("returns null for non-disk", () => {
    expect(
      parseFilesDiskSourceFromParams({
        source: { kind: "untitled", name: "x" },
      })
    ).toBeNull();
  });
});

describe("sameFilesDiskSource", () => {
  it("treats slash variants as the same identity", () => {
    expect(
      sameFilesDiskSource(
        { root: "/Users/a/pier/", path: "src/a.ts" },
        { root: "/Users/a/pier", path: "src\\a.ts" }
      )
    ).toBe(true);
  });
});
