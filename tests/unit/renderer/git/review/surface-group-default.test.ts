import { describe, expect, it } from "vitest";
import { preferredUncommittedReadingSurface } from "../../../../../src/plugins/builtin/git/renderer/review/surface-group.ts";

describe("preferredUncommittedReadingSurface", () => {
  it("returns index when no groups yet", () => {
    expect(preferredUncommittedReadingSurface([])).toBe("index");
  });

  it("prefers staged over unstaged when both present (presentation order)", () => {
    expect(preferredUncommittedReadingSurface(["staged", "unstaged"])).toBe(
      "staged"
    );
  });

  it("uses unstaged-only as index surface", () => {
    expect(preferredUncommittedReadingSurface(["unstaged"])).toBe("index");
  });

  it("prefers conflict first when present", () => {
    expect(
      preferredUncommittedReadingSurface(["conflict", "staged", "unstaged"])
    ).toBe("conflict");
  });
});
