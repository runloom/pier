import { describe, expect, it, vi } from "vitest";
import type { ClaudeAccountsService } from "../../../packages/plugin-claude/src/main/accounts-service-contract.ts";
import { registerClaudeRpcHandlers } from "../../../packages/plugin-claude/src/main/rpc-handlers.ts";

function serviceStub(): ClaudeAccountsService {
  return {
    add: vi.fn(),
    adoptCurrent: vi.fn(),
    cancelLogin: vi.fn(),
    completeLogin: vi.fn(),
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
      schemaVersion: 1 as const,
    })),
  };
}

function register(service = serviceStub()) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  const acquireUsagePolling = vi.fn(async () => undefined);
  const releaseUsagePolling = vi.fn();
  registerClaudeRpcHandlers({
    acquireUsagePolling,
    releaseUsagePolling,
    rpc: {
      handle: (method, handler) => {
        handlers.set(method, handler);
      },
    },
    service,
  });
  return { acquireUsagePolling, handlers, releaseUsagePolling, service };
}

describe("Claude plugin RPC handlers", () => {
  it("registers the full accounts surface including login and usage", async () => {
    const { acquireUsagePolling, handlers, releaseUsagePolling, service } =
      register();

    expect([...handlers.keys()].sort()).toEqual([
      "accounts.add",
      "accounts.adoptCurrent",
      "accounts.cancelLogin",
      "accounts.completeLogin",
      "accounts.refreshAllUsage",
      "accounts.refreshUsage",
      "accounts.remove",
      "accounts.select",
      "accounts.snapshot",
      "accounts.usagePolling.acquire",
      "accounts.usagePolling.release",
    ]);

    await handlers.get("accounts.snapshot")?.(null);
    expect(service.snapshot).toHaveBeenCalledOnce();

    await handlers.get("accounts.add")?.({ kind: "oauth" });
    expect(service.add).toHaveBeenCalledWith({ kind: "oauth" });

    await handlers.get("accounts.adoptCurrent")?.(null);
    expect(service.adoptCurrent).toHaveBeenCalledOnce();

    await handlers.get("accounts.completeLogin")?.({ code: "abc#state" });
    expect(service.completeLogin).toHaveBeenCalledWith({ code: "abc#state" });

    await handlers.get("accounts.cancelLogin")?.(null);
    expect(service.cancelLogin).toHaveBeenCalledOnce();

    await handlers.get("accounts.select")?.({ accountId: "a1" });
    expect(service.select).toHaveBeenCalledWith({ accountId: "a1" });

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

  it("rejects empty ids and codes", async () => {
    const { handlers } = register();
    await expect(
      handlers.get("accounts.select")?.({ accountId: "" })
    ).rejects.toThrow();
    await expect(
      handlers.get("accounts.remove")?.({ accountId: "" })
    ).rejects.toThrow();
    await expect(
      handlers.get("accounts.completeLogin")?.({ code: "" })
    ).rejects.toThrow();
  });
});
