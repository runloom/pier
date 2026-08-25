import type { PluginRpcBus } from "@main/plugins/rpc-bus.ts";
import { createPluginDataProjectionService } from "@main/services/plugin-data-projections/service.ts";
import type { PluginRpcInvokeRequest } from "@shared/contracts/plugin/rpc.ts";
import { describe, expect, test, vi } from "vitest";

describe("createPluginDataProjectionService", () => {
  test("snapshot proxies declared projection via rpc bus", async () => {
    const calls: PluginRpcInvokeRequest[] = [];
    const service = createPluginDataProjectionService({
      broadcastToWindows: () => {},
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request);
          return { data: { ok: 1 }, ok: true };
        },
      } as unknown as PluginRpcBus,
      manifestProjections: (id) =>
        id === "pier.codex" ? ["accounts.usage"] : [],
    });
    await expect(
      service.snapshot("pier.codex", "accounts.usage")
    ).resolves.toEqual({ ok: 1 });
    expect(calls[0]).toMatchObject({
      method: "projection.accounts.usage",
      pluginId: "pier.codex",
    });
  });

  test("undeclared keys are rejected before touching the bus", async () => {
    const invoke = vi.fn();
    const service = createPluginDataProjectionService({
      broadcastToWindows: () => {},
      bus: { invoke } as unknown as PluginRpcBus,
      manifestProjections: () => [],
    });
    await expect(
      service.snapshot("pier.codex", "accounts.usage")
    ).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test("bus not_found maps to unsupported so the host degrades gracefully", async () => {
    const service = createPluginDataProjectionService({
      broadcastToWindows: () => {},
      bus: {
        invoke: async () => ({
          error: {
            code: "not_found",
            message: "plugin has no projection accounts.usage",
          },
          ok: false,
        }),
      } as unknown as PluginRpcBus,
      manifestProjections: (id) =>
        id === "pier.codex" ? ["accounts.usage"] : [],
    });
    await expect(
      service.snapshot("pier.codex", "accounts.usage")
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  test("bus internal errors surface as plain errors with message intact", async () => {
    const service = createPluginDataProjectionService({
      broadcastToWindows: () => {},
      bus: {
        invoke: async () => ({
          error: { code: "internal_error", message: "projection blew up" },
          ok: false,
        }),
      } as unknown as PluginRpcBus,
      manifestProjections: (id) =>
        id === "pier.codex" ? ["accounts.usage"] : [],
    });
    const error = await service
      .snapshot("pier.codex", "accounts.usage")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("projection blew up");
    expect((error as Error & { code?: string }).code).toBeUndefined();
  });

  test("tapEvents forwards only declared keys", () => {
    let listener: ((event: string, payload: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const service = createPluginDataProjectionService({
      broadcastToWindows: (_channel, payload) => sent.push(payload),
      bus: {
        onEvent: (fn: (event: string, payload: unknown) => void) => {
          listener = fn;
          return () => {};
        },
      } as unknown as PluginRpcBus,
      manifestProjections: (id) =>
        id === "pier.codex" ? ["accounts.usage"] : [],
    });
    const dispose = service.tapEvents();
    listener?.("projection.accounts.usage", { pluginId: "pier.codex", v: 2 });
    listener?.("projection.other.key", { pluginId: "pier.codex", v: 3 });
    expect(sent).toEqual([
      { key: "accounts.usage", pluginId: "pier.codex", v: 2 },
    ]);
    dispose();
  });
});
