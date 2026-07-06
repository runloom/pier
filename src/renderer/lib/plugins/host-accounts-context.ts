import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useAgentAccountsStore } from "../../stores/agent-accounts.store.ts";

const EMPTY_SNAPSHOT: AgentAccountsSnapshot = {
  accounts: [],
  activeAccountId: null,
  lastLoginError: null,
  loginPending: null,
  ts: 0,
  usage: {},
};

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

export function createPluginAccountsContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["accounts"] {
  return {
    add: (provider) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.add(provider);
    },
    adoptCurrent: () => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.adoptCurrent();
    },
    cancelLogin: (provider) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.cancelLogin(provider);
    },
    onDidChange: (cb) => {
      assertPluginCapability(entry, "account:read");
      return useAgentAccountsStore.subscribe((state) => {
        if (state.snapshot) {
          cb(state.snapshot);
        }
      });
    },
    refreshUsage: () => {
      assertPluginCapability(entry, "account:read");
      return window.pier.accounts.refreshUsage();
    },
    remove: (accountId) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.remove(accountId);
    },
    select: (accountId) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.select(accountId);
    },
    snapshot: () => {
      assertPluginCapability(entry, "account:read");
      return useAgentAccountsStore.getState().snapshot ?? EMPTY_SNAPSHOT;
    },
  };
}
