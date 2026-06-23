import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

describe("projectPreferencesSchema — monoFontSize", () => {
  it("默认值是 13", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.monoFontSize).toBe(13);
  });

  it("接受边界值 8 和 32", () => {
    expect(
      projectPreferencesSchema.parse({ monoFontSize: 8 }).monoFontSize
    ).toBe(8);
    expect(
      projectPreferencesSchema.parse({ monoFontSize: 32 }).monoFontSize
    ).toBe(32);
  });

  it("拒绝越界 (7 / 33)", () => {
    expect(() =>
      projectPreferencesSchema.parse({ monoFontSize: 7 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ monoFontSize: 33 })
    ).toThrow();
  });

  it("拒绝非整数 (12.5)", () => {
    expect(() =>
      projectPreferencesSchema.parse({ monoFontSize: 12.5 })
    ).toThrow();
  });
});
