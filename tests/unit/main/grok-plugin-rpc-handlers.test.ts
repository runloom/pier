import { describe, expect, it, vi } from "vitest";
import type { GrokAccountsService } from "../../../packages/plugin-grok/src/main/accounts-service-contract.ts";
import { registerGrokRpcHandlers } from "../../../packages/plugin-grok/src/main/rpc-handlers.ts";

function serviceStub(): GrokAccountsService {
  return {
    add: vi.fn(),
    cancelLogin: vi.fn(),
    dispose: vi.fn(),
    flush: vi.fn(),
    init: vi.fn(),
    refreshAllUsage: vi.fn(),
    refreshUsage: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    snapshot: vi.fn(() => ({
      accounts: [],
      activeAccountId: null,
      login: null,
      revision: 1,
      schemaVersion: 1,
    })),
    syncToPeers: vi.fn(),
  };
}

describe("Grok plugin RPC handlers", () => {
  it("registers accounts methods including syncToPeers", async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const service = serviceStub();
    const acquireUsagePolling = vi.fn(async () => undefined);
    const releaseUsagePolling = vi.fn();
    registerGrokRpcHandlers({
      acquireUsagePolling,
      releaseUsagePolling,
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service,
    });

    expect([...handlers.keys()].sort()).toEqual([
      "accounts.add",
      "accounts.cancelLogin",
      "accounts.refreshAllUsage",
      "accounts.refreshUsage",
      "accounts.remove",
      "accounts.select",
      "accounts.snapshot",
      "accounts.syncToPeers",
      "accounts.usagePolling.acquire",
      "accounts.usagePolling.release",
    ]);

    await handlers.get("accounts.snapshot")?.(null);
    expect(service.snapshot).toHaveBeenCalledOnce();

    await handlers.get("accounts.add")?.({ kind: "api_key", apiKey: "xai-1" });
    expect(service.add).toHaveBeenCalledWith({
      apiKey: "xai-1",
      kind: "api_key",
    });

    await handlers.get("accounts.select")?.({
      accountId: "a1",
      syncTargets: ["opencode"],
    });
    expect(service.select).toHaveBeenCalledWith({
      accountId: "a1",
      syncTargets: ["opencode"],
    });

    await handlers.get("accounts.syncToPeers")?.({
      accountId: "a1",
      syncTargets: ["pi", "omp"],
    });
    expect(service.syncToPeers).toHaveBeenCalledWith({
      accountId: "a1",
      syncTargets: ["pi", "omp"],
    });

    await handlers.get("accounts.remove")?.({ accountId: "a1" });
    expect(service.remove).toHaveBeenCalledWith({ accountId: "a1" });

    await handlers.get("accounts.refreshUsage")?.({});
    expect(service.refreshUsage).toHaveBeenCalled();

    await handlers.get("accounts.refreshAllUsage")?.(null);
    expect(service.refreshAllUsage).toHaveBeenCalledWith({ force: true });

    await handlers.get("accounts.usagePolling.acquire")?.({
      consumerId: "widget:1",
    });
    expect(acquireUsagePolling).toHaveBeenCalledWith("widget:1");

    await handlers.get("accounts.usagePolling.release")?.({
      consumerId: "widget:1",
    });
    expect(releaseUsagePolling).toHaveBeenCalledWith("widget:1");
  });

  it("rejects empty api keys", async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    registerGrokRpcHandlers({
      acquireUsagePolling: vi.fn(async () => undefined),
      releaseUsagePolling: vi.fn(),
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service: serviceStub(),
    });
    await expect(
      handlers.get("accounts.add")?.({ kind: "api_key", apiKey: "" })
    ).rejects.toThrow();
  });
});
