import {
  mruEntrySchema,
  mruStateSchema,
} from "@shared/contracts/command-palette-mru.ts";
import { describe, expect, it } from "vitest";

describe("command-palette-mru schema", () => {
  it("接受最小合法 entry", () => {
    const parsed = mruEntrySchema.parse({
      actionId: "pier.x",
      useCount: 1,
      lastUsedAt: 1_700_000_000_000,
    });
    expect(parsed.actionId).toBe("pier.x");
  });

  it("拒绝空 actionId", () => {
    expect(() =>
      mruEntrySchema.parse({ actionId: "", useCount: 0, lastUsedAt: 0 })
    ).toThrow();
  });

  it("拒绝负 useCount", () => {
    expect(() =>
      mruEntrySchema.parse({ actionId: "x", useCount: -1, lastUsedAt: 0 })
    ).toThrow();
  });

  it("默认 state 通过校验", () => {
    const parsed = mruStateSchema.parse({ version: 1, entries: [] });
    expect(parsed.entries).toEqual([]);
  });

  it("拒绝超过 200 条 entries", () => {
    const entries = Array.from({ length: 201 }, (_, i) => ({
      actionId: `a${i}`,
      useCount: 1,
      lastUsedAt: 0,
    }));
    expect(() => mruStateSchema.parse({ version: 1, entries })).toThrow();
  });
});
