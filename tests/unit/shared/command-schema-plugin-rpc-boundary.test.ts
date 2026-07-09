import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { describe, expect, it } from "vitest";

describe("PierCommand schema plugin RPC boundary", () => {
  it("rejects a raw pluginRpc.invoke shape as a PierCommand", () => {
    const result = pierCommandSchema.safeParse({
      type: "pluginRpc.invoke",
      pluginId: "pier.codex",
      method: "accounts.snapshot",
      payload: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a legacy `pluginRpc:invoke` variant", () => {
    const result = pierCommandSchema.safeParse({
      type: "pluginRpc:invoke",
      pluginId: "pier.codex",
      method: "accounts.snapshot",
    });
    expect(result.success).toBe(false);
  });

  it("accepts plugin.catalog.list which IS a legitimate PierCommand", () => {
    const result = pierCommandSchema.safeParse({ type: "plugin.catalog.list" });
    expect(result.success).toBe(true);
  });
});
