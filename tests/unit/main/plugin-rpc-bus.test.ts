import { createPluginRpcBus } from "@main/plugins/plugin-rpc-bus.ts";
import { describe, expect, it, vi } from "vitest";

describe("createPluginRpcBus", () => {
  it("scopes handlers by plugin id and clears only the requested plugin", async () => {
    const bus = createPluginRpcBus({ broadcast: vi.fn() });
    bus.handle("pier.first", "snapshot", async () => "first");
    bus.handle("pier.second", "snapshot", async () => "second");

    await expect(
      bus.invoke({ method: "snapshot", payload: null, pluginId: "pier.first" })
    ).resolves.toEqual({ data: "first", ok: true });
    await expect(
      bus.invoke({ method: "snapshot", payload: null, pluginId: "pier.second" })
    ).resolves.toEqual({ data: "second", ok: true });

    bus.clearPlugin("pier.first");
    await expect(
      bus.invoke({ method: "snapshot", payload: null, pluginId: "pier.first" })
    ).resolves.toMatchObject({ error: { code: "not_found" }, ok: false });
    await expect(
      bus.invoke({ method: "snapshot", payload: null, pluginId: "pier.second" })
    ).resolves.toEqual({ data: "second", ok: true });
  });

  it("converts handler failures into the RPC error envelope", async () => {
    const bus = createPluginRpcBus({ broadcast: vi.fn() });
    bus.handle("pier.first", "fail", async () => {
      throw new Error("boom");
    });

    await expect(
      bus.invoke({ method: "fail", payload: null, pluginId: "pier.first" })
    ).resolves.toEqual({
      error: { code: "internal_error", message: "boom" },
      ok: false,
    });
  });

  it("does not collide when plugin ids and methods contain separators", async () => {
    const bus = createPluginRpcBus({ broadcast: vi.fn() });
    bus.handle("pier:a", "b", async () => "first");
    bus.handle("pier", "a:b", async () => "second");

    await expect(
      bus.invoke({ method: "b", payload: null, pluginId: "pier:a" })
    ).resolves.toEqual({ data: "first", ok: true });
    await expect(
      bus.invoke({ method: "a:b", payload: null, pluginId: "pier" })
    ).resolves.toEqual({ data: "second", ok: true });
  });
});
