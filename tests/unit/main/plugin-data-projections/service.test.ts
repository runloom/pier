import type {
  PluginRpcBus,
  PluginRpcEventData,
} from "@main/plugins/rpc-bus.ts";
import {
  createManifestProjectionReader,
  createPluginDataProjectionService,
} from "@main/services/plugin-data-projections/service.ts";
import type { PluginService } from "@main/services/plugin-service.ts";
import type { PluginRpcInvokeRequest } from "@shared/contracts/plugin/rpc.ts";
import { describe, expect, test, vi } from "vitest";

function service(input: {
  bus?: Partial<PluginRpcBus>;
  manifestActions?: (pluginId: string) => readonly string[];
  manifestProjections?: (pluginId: string) => readonly string[];
  sent?: unknown[];
}) {
  return createPluginDataProjectionService({
    broadcastToWindows: (_channel, payload) => {
      input.sent?.push(payload);
    },
    bus: {
      invoke: async () => ({ data: null, ok: true }),
      ...input.bus,
    } as PluginRpcBus,
    manifestActions:
      input.manifestActions ??
      ((id) => (id === "pier.codex" ? ["accounts.select"] : [])),
    manifestProjections:
      input.manifestProjections ??
      ((id) => (id === "pier.codex" ? ["accounts"] : [])),
  });
}

describe("createPluginDataProjectionService", () => {
  test("snapshot proxies declared projection via rpc bus", async () => {
    const calls: PluginRpcInvokeRequest[] = [];
    const projections = service({
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request);
          return { data: { ok: 1 }, ok: true };
        },
      },
    });
    await expect(
      projections.snapshot("pier.codex", "accounts")
    ).resolves.toEqual({ ok: 1 });
    expect(calls[0]).toMatchObject({
      method: "projection.accounts",
      pluginId: "pier.codex",
    });
  });

  test("undeclared keys are rejected before touching the bus", async () => {
    const invoke = vi.fn();
    const projections = service({
      bus: { invoke },
      manifestProjections: () => [],
    });
    await expect(
      projections.snapshot("pier.codex", "accounts")
    ).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test("bus not_found maps to unsupported so the host degrades gracefully", async () => {
    const projections = service({
      bus: {
        invoke: async () => ({
          error: {
            code: "not_found",
            message: "plugin has no projection accounts",
          },
          ok: false,
        }),
      },
    });
    await expect(
      projections.snapshot("pier.codex", "accounts")
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  test("bus internal errors surface as plain errors with message intact", async () => {
    const projections = service({
      bus: {
        invoke: async () => ({
          error: { code: "internal_error", message: "projection blew up" },
          ok: false,
        }),
      },
    });
    const error = await projections
      .snapshot("pier.codex", "accounts")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("projection blew up");
    expect((error as Error & { code?: string }).code).toBeUndefined();
  });

  test("tapEvents forwards only declared keys", () => {
    let listener:
      | ((event: string, data: PluginRpcEventData) => void)
      | undefined;
    const sent: unknown[] = [];
    const projections = service({
      bus: {
        onEvent: (fn) => {
          listener = fn;
          return () => {};
        },
      },
      sent,
    });
    const dispose = projections.tapEvents();
    listener?.("projection.accounts", { pluginId: "pier.codex", v: 2 });
    listener?.("projection.other.key", { pluginId: "pier.codex", v: 3 });
    expect(sent).toEqual([{ key: "accounts", pluginId: "pier.codex", v: 2 }]);
    dispose();
  });

  test("invokeAction uses the declared key without a projection prefix", async () => {
    const calls: PluginRpcInvokeRequest[] = [];
    const projections = service({
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request);
          return { data: { switched: true }, ok: true };
        },
      },
    });
    await expect(
      projections.invokeAction("pier.codex", "accounts.select", {
        accountId: "a1",
      })
    ).resolves.toEqual({ switched: true });
    expect(calls[0]).toEqual({
      method: "accounts.select",
      payload: { accountId: "a1" },
      pluginId: "pier.codex",
    });
  });

  test("undeclared actions are rejected before touching the bus", async () => {
    const invoke = vi.fn();
    const projections = service({
      bus: { invoke },
      manifestActions: () => [],
    });
    await expect(
      projections.invokeAction("pier.codex", "accounts.select", null)
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(invoke).not.toHaveBeenCalled();
  });

  test("watchStart refcounts and calls projection watch only on the first lease", async () => {
    const calls: string[] = [];
    const projections = service({
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request.method);
          return { data: null, ok: true };
        },
      },
    });
    await projections.watchStart("pier.codex", "accounts");
    await projections.watchStart("pier.codex", "accounts");
    await projections.watchStop("pier.codex", "accounts");
    await projections.watchStop("pier.codex", "accounts");
    expect(calls).toEqual([
      "projection.accounts.watch",
      "projection.accounts.unwatch",
    ]);
  });

  test("missing watch handlers are ignored", async () => {
    const projections = service({
      bus: {
        invoke: async () => ({
          error: { code: "not_found", message: "no watch handler" },
          ok: false,
        }),
      },
    });
    await expect(
      projections.watchStart("pier.codex", "accounts")
    ).resolves.toBeUndefined();
    await expect(
      projections.watchStop("pier.codex", "accounts")
    ).resolves.toBeUndefined();
  });

  test("undeclared watch targets never touch the bus", async () => {
    const invoke = vi.fn();
    const projections = service({
      bus: { invoke },
      manifestProjections: () => [],
    });
    await expect(
      projections.watchStart("pier.codex", "accounts")
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(invoke).not.toHaveBeenCalled();
  });

  test("declares by base key and leases by canonical params", async () => {
    const calls: PluginRpcInvokeRequest[] = [];
    const projections = service({
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request);
          return { data: { ok: true }, ok: true };
        },
      },
      manifestProjections: (id) => (id === "pier.tasks" ? ["board"] : []),
    });
    await expect(
      projections.snapshot("pier.tasks", "board", { milestone: "结算重构" })
    ).resolves.toEqual({ ok: true });
    await projections.watchStart("pier.tasks", "board", {
      milestone: "结算重构",
    });
    await projections.watchStart("pier.tasks", "board", { label: "req/x" });
    await projections.watchStart("pier.tasks", "board", {
      milestone: "结算重构",
    });
    await projections.watchStop("pier.tasks", "board", {
      milestone: "结算重构",
    });
    expect(calls.map((call) => [call.method, call.payload])).toEqual([
      ["projection.board", { params: { milestone: "结算重构" } }],
      ["projection.board.watch", { params: { milestone: "结算重构" } }],
      ["projection.board.watch", { params: { label: "req/x" } }],
    ]);
    await projections.watchStop("pier.tasks", "board", { label: "req/x" });
    await projections.watchStop("pier.tasks", "board", {
      milestone: "结算重构",
    });
    expect(calls.at(-2)).toMatchObject({
      method: "projection.board.unwatch",
      payload: { params: { label: "req/x" } },
    });
    expect(calls.at(-1)).toMatchObject({
      method: "projection.board.unwatch",
      payload: { params: { milestone: "结算重构" } },
    });
  });

  test("tapEvents keeps params on the broadcast envelope", () => {
    let listener:
      | ((event: string, data: PluginRpcEventData) => void)
      | undefined;
    const sent: unknown[] = [];
    const projections = service({
      bus: {
        onEvent: (fn) => {
          listener = fn;
          return () => {};
        },
      },
      manifestProjections: (id) => (id === "pier.tasks" ? ["board"] : []),
      sent,
    });
    const dispose = projections.tapEvents();
    listener?.("projection.board", {
      columns: [],
      params: { milestone: "结算重构" },
      pluginId: "pier.tasks",
    });
    listener?.("projection.board", {
      columns: ["other"],
      params: { label: "req/x" },
      pluginId: "pier.tasks",
    });
    expect(sent).toEqual([
      {
        columns: [],
        key: "board",
        params: { milestone: "结算重构" },
        pluginId: "pier.tasks",
      },
      {
        columns: ["other"],
        key: "board",
        params: { label: "req/x" },
        pluginId: "pier.tasks",
      },
    ]);
    dispose();
  });

  test("query-string keys still declare against the base key", async () => {
    const calls: PluginRpcInvokeRequest[] = [];
    const projections = service({
      bus: {
        invoke: async (request: PluginRpcInvokeRequest) => {
          calls.push(request);
          return { data: { ok: 1 }, ok: true };
        },
      },
      manifestProjections: (id) => (id === "pier.tasks" ? ["board"] : []),
    });
    await projections.snapshot("pier.tasks", "board?milestone=结算重构");
    expect(calls[0]).toEqual({
      method: "projection.board",
      payload: { params: { milestone: "结算重构" } },
      pluginId: "pier.tasks",
    });
  });
});

describe("createManifestProjectionReader", () => {
  test("indexes projections and canvas actions from the plugin list", async () => {
    const reader = createManifestProjectionReader({
      list: async () => ({
        entries: [
          {
            manifest: {
              canvasActions: ["accounts.select"],
              dataProjections: ["accounts"],
              id: "pier.codex",
            },
          },
        ],
      }),
    } as unknown as PluginService);
    await reader.refresh();
    expect(reader.read("pier.codex")).toEqual(["accounts"]);
    expect(reader.readActions("pier.codex")).toEqual(["accounts.select"]);
    expect(reader.read("missing")).toEqual([]);
    expect(reader.readActions("missing")).toEqual([]);
  });
});
