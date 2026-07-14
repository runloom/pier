import { describe, expect, it, vi } from "vitest";
import type { CodexAccountsService } from "../../../packages/plugin-codex/src/main/accounts-service-contract.ts";
import { registerCodexRpcHandlers } from "../../../packages/plugin-codex/src/main/rpc-handlers.ts";

function serviceStub(): CodexAccountsService {
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

describe("Codex plugin RPC handlers", () => {
  it("keeps quota refresh independent from local cost scanning", async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const service = serviceStub();
    const acquireUsagePolling = vi.fn(async () => undefined);
    const releaseUsagePolling = vi.fn();
    registerCodexRpcHandlers({
      acquireUsagePolling,
      releaseUsagePolling,
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service,
    });

    await handlers.get("accounts.refreshUsage")?.({ accountId: "account-1" });

    expect(service.refreshUsage).toHaveBeenCalledWith({
      accountId: "account-1",
      force: true,
    });
  });

  it("no longer exposes usage.refreshCost — cost refresh is host-owned", () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const acquireUsagePolling = vi.fn(async () => undefined);
    const releaseUsagePolling = vi.fn();
    registerCodexRpcHandlers({
      acquireUsagePolling,
      releaseUsagePolling,
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service: serviceStub(),
    });

    expect(handlers.has("usage.refreshCost")).toBe(false);
  });

  it("tracks renderer polling leases through dedicated RPC methods", async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const acquireUsagePolling = vi.fn(async () => undefined);
    const releaseUsagePolling = vi.fn();
    registerCodexRpcHandlers({
      acquireUsagePolling,
      releaseUsagePolling,
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service: serviceStub(),
    });

    await handlers.get("accounts.usagePolling.acquire")?.({
      consumerId: "widget:account-1",
    });
    await handlers.get("accounts.usagePolling.release")?.({
      consumerId: "widget:account-1",
    });

    expect(acquireUsagePolling).toHaveBeenCalledWith("widget:account-1");
    expect(releaseUsagePolling).toHaveBeenCalledWith("widget:account-1");
  });

  it("routes accounts.syncToPeers to the service", async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const service = serviceStub();
    registerCodexRpcHandlers({
      acquireUsagePolling: vi.fn(async () => undefined),
      releaseUsagePolling: vi.fn(),
      rpc: {
        handle: (method, handler) => {
          handlers.set(method, handler);
        },
      },
      service,
    });

    await handlers.get("accounts.syncToPeers")?.({
      syncTargets: ["omp", "opencode"],
    });

    expect(service.syncToPeers).toHaveBeenCalledWith({
      syncTargets: ["omp", "opencode"],
    });
  });
});
