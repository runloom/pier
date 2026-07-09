import { describe, expect, it } from "vitest";
import { remainingPercent } from "../../../packages/plugin-codex/src/shared/usage.ts";

describe("remainingPercent", () => {
  it("returns 100 minus used, rounded", () => {
    expect(remainingPercent(32)).toBe(68);
    expect(remainingPercent(32.4)).toBe(68);
    expect(remainingPercent(32.6)).toBe(67);
  });

  it("clamps to 0 when usage exceeds 100%", () => {
    expect(remainingPercent(100)).toBe(0);
    expect(remainingPercent(150)).toBe(0);
  });

  it("clamps to 100 when usage is below 0%", () => {
    expect(remainingPercent(0)).toBe(100);
    expect(remainingPercent(-10)).toBe(100);
  });
});
