import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import { describe, expect, it, vi } from "vitest";
import { createManagedPluginCatalogProvider } from "../../../../src/main/services/host-catalog/providers/managed-plugin.ts";

function catalog(): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release",
    plugins: [
      {
        desired: { enabled: true, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Codex",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.codex",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: null,
      },
    ],
  };
}

describe("createManagedPluginCatalogProvider", () => {
  it("lists the local catalog without refreshing the official index", async () => {
    const refresh = vi.fn(async () => undefined);
    const provider = createManagedPluginCatalogProvider({
      list: async () => catalog(),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("managed-plugin"),
        write: async () => undefined,
      },
      refreshOfficial: refresh,
      waitReady: async () => undefined,
    });

    const snapshot = await provider.probeLocal({ env: {}, now: 1 });
    expect(refresh).not.toHaveBeenCalled();
    expect(snapshot.items.some((item) => item.id === "pier.codex")).toBe(true);
  });

  it("refreshes the official index only on remote probe", async () => {
    const refresh = vi.fn(async () => undefined);
    const provider = createManagedPluginCatalogProvider({
      list: async () => catalog(),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("managed-plugin"),
        write: async () => undefined,
      },
      refreshOfficial: refresh,
      waitReady: async () => undefined,
    });

    if (!provider.probeRemote) {
      throw new Error("expected probeRemote");
    }
    await provider.probeRemote({ env: {}, now: 2 });
    expect(refresh).toHaveBeenCalledWith(false);
  });

  it("forwards ensureFresh force into official index refresh", async () => {
    const refresh = vi.fn(async () => undefined);
    const provider = createManagedPluginCatalogProvider({
      list: async () => catalog(),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("managed-plugin"),
        write: async () => undefined,
      },
      refreshOfficial: refresh,
      waitReady: async () => undefined,
    });
    if (!provider.probeRemote) {
      throw new Error("expected probeRemote");
    }
    await provider.probeRemote({ env: {}, force: true, now: 3 });
    expect(refresh).toHaveBeenCalledWith(true);
  });
});
