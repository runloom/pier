import {
  domainToManagedPluginCatalog,
  MANAGED_PLUGIN_META_ID,
  managedPluginCatalogToItems,
} from "@shared/contracts/host-catalog/managed-plugin.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import { describe, expect, it } from "vitest";

function sampleCatalog(): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 99,
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
        update: { version: "1.1.0" },
      },
    ],
  };
}

describe("managed plugin catalog mapping", () => {
  it("round-trips a catalog snapshot through domain items", () => {
    const items = managedPluginCatalogToItems(sampleCatalog());
    expect(items.some((item) => item.id === MANAGED_PLUGIN_META_ID)).toBe(true);
    const codex = items.find((item) => item.id === "pier.codex");
    expect(codex?.presence).toBe("present");
    expect(codex?.localVersion).toBe("1.0.0");
    expect(codex?.remoteVersion).toBe("1.1.0");
    expect(codex?.updateOffered).toBe(true);

    const restored = domainToManagedPluginCatalog({
      ...emptyDomainSnapshot("managed-plugin"),
      items,
      localProbedAt: 99,
    });
    expect(restored).toMatchObject({
      officialMutationsAllowed: true,
      pluginMode: "release",
      plugins: [{ id: "pier.codex", installed: true }],
    });
  });

  it("returns null when the domain has no plugin rows", () => {
    expect(
      domainToManagedPluginCatalog(emptyDomainSnapshot("managed-plugin"))
    ).toBeNull();
  });
});
