import {
  extractPluginDataEvent,
  isPluginDataEventFor,
} from "@shared/contracts/canvas-host.ts";
import { describe, expect, it } from "vitest";

describe("plugin data projection events", () => {
  const target = { key: "accounts.usage", pluginId: "pier.codex" };

  it("matches events only on pluginId and key regardless of shape", () => {
    expect(
      isPluginDataEventFor(
        { key: "accounts.usage", pluginId: "pier.codex" },
        target
      )
    ).toBe(true);
    expect(
      isPluginDataEventFor(
        { key: "accounts.usage", payload: [1], pluginId: "pier.codex" },
        target
      )
    ).toBe(true);
    expect(
      isPluginDataEventFor({ key: "other", pluginId: "pier.codex" }, target)
    ).toBe(false);
    expect(
      isPluginDataEventFor({ key: "accounts.usage", pluginId: "other" }, target)
    ).toBe(false);
    expect(isPluginDataEventFor({ key: "accounts.usage" }, target)).toBe(false);
    expect(isPluginDataEventFor(null, target)).toBe(false);
    expect(isPluginDataEventFor("scalar", target)).toBe(false);
  });

  it("extracts flattened object payloads by stripping envelope fields", () => {
    expect(
      extractPluginDataEvent({ key: "k", pluginId: "p", total: 10, used: 3 })
    ).toEqual({ total: 10, used: 3 });
    // 纯信封事件 → 空数据对象。
    expect(extractPluginDataEvent({ key: "k", pluginId: "p" })).toEqual({});
  });

  it("extracts wrapped payloads from the payload field", () => {
    expect(
      extractPluginDataEvent({ key: "k", payload: [1, 2], pluginId: "p" })
    ).toEqual([1, 2]);
    expect(
      extractPluginDataEvent({ key: "k", payload: null, pluginId: "p" })
    ).toBeNull();
    expect(
      extractPluginDataEvent({ key: "k", payload: "text", pluginId: "p" })
    ).toBe("text");
  });

  it("returns null for non-record events", () => {
    expect(extractPluginDataEvent(null)).toBeNull();
    expect(extractPluginDataEvent("nope")).toBeNull();
    expect(extractPluginDataEvent(42)).toBeNull();
  });
});
