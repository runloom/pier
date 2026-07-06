import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginAccountsContext } from "@/lib/plugins/host-accounts-context.ts";
import { useAgentAccountsStore } from "@/stores/agent-accounts.store.ts";

function entry(perms: PierCapability[]): PluginRegistryEntry {
  return {
    effectivePermissions: perms,
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      name: "Codex",
      panels: [],
      permissions: perms,
      source: { kind: "builtin" as const },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" as const },
  };
}

function assertPluginCapability(
  e: PluginRegistryEntry | undefined,
  capability: PierCapability
): void {
  if (!e || e.effectivePermissions.includes(capability)) {
    return;
  }
  throw new Error(
    `plugin capability not granted: ${e.manifest.id}:${capability}`
  );
}

const fakeSnapshot: AgentAccountsSnapshot = {
  accounts: [],
  activeAccountId: null,
  lastLoginError: null,
  loginPending: null,
  ts: 1,
  usage: {},
};

const capabilityErrorPattern = /capability not granted/;

describe("createPluginAccountsContext", () => {
  beforeEach(() => {
    useAgentAccountsStore.setState({ snapshot: fakeSnapshot, ts: 1 });
    vi.stubGlobal("window", {
      ...window,
      pier: {
        accounts: {
          add: vi.fn().mockResolvedValue(undefined),
          adoptCurrent: vi.fn().mockResolvedValue(undefined),
          cancelLogin: vi.fn().mockResolvedValue(undefined),
          refreshUsage: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it("snapshot without account:read throws", () => {
    const ctx = createPluginAccountsContext(entry([]), assertPluginCapability);
    expect(() => ctx.snapshot()).toThrow(capabilityErrorPattern);
  });

  it("snapshot with account:read returns store value", () => {
    const ctx = createPluginAccountsContext(
      entry(["account:read"]),
      assertPluginCapability
    );
    expect(ctx.snapshot()).toBe(fakeSnapshot);
  });

  it("select without account:write throws", () => {
    const ctx = createPluginAccountsContext(
      entry(["account:read"]),
      assertPluginCapability
    );
    expect(() => ctx.select("acc-1")).toThrow(capabilityErrorPattern);
  });

  it("add with account:write calls window.pier.accounts", async () => {
    const ctx = createPluginAccountsContext(
      entry(["account:write"]),
      assertPluginCapability
    );
    await ctx.add("codex");
    expect(window.pier.accounts.add).toHaveBeenCalledWith("codex");
  });

  it("onDidChange without account:read throws", () => {
    const ctx = createPluginAccountsContext(entry([]), assertPluginCapability);
    // biome-ignore lint/suspicious/noEmptyBlockStatements: noop callback for test
    expect(() => ctx.onDidChange(() => {})).toThrow(capabilityErrorPattern);
  });
});
