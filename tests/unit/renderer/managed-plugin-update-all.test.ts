import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import { describe, expect, it, vi } from "vitest";
import {
  formatManagedPluginUpdateAllAlertBody,
  listUpdatableManagedPlugins,
  runManagedPluginUpdateAll,
} from "@/pages/settings/components/managed-plugin-update-all.ts";

function row(
  partial: Partial<ManagedPluginCatalogSnapshot["plugins"][number]> & {
    id: string;
  }
): ManagedPluginCatalogSnapshot["plugins"][number] {
  return {
    desired: { enabled: true, source: "official", version: "1.0.0" },
    diagnostics: [],
    displayName: partial.displayName ?? partial.id,
    effective: { enabled: true, source: "official", version: "1.0.0" },
    id: partial.id,
    installed: partial.installed ?? true,
    lastKnownGoodVersion: "1.0.0",
    offlineRestoreAvailable: false,
    pendingRestart: null,
    update:
      partial.update === undefined ? { version: "1.1.0" } : partial.update,
    ...partial,
  };
}

function snap(
  plugins: ManagedPluginCatalogSnapshot["plugins"],
  extra?: Partial<ManagedPluginCatalogSnapshot>
): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release",
    plugins,
    ...extra,
  };
}

describe("listUpdatableManagedPlugins", () => {
  it("returns installed rows with update when mutations allowed, sorted by id", () => {
    const list = listUpdatableManagedPlugins(
      snap([
        row({ id: "pier.z", displayName: "Zed", update: { version: "2.0.0" } }),
        row({ id: "pier.a", displayName: "Ada", update: { version: "1.2.0" } }),
        row({ id: "pier.skip", update: null }),
        row({
          id: "pier.gone",
          installed: false,
          update: { version: "9.0.0" },
        }),
      ]),
      true
    );
    expect(list.map((x) => x.id)).toEqual(["pier.a", "pier.z"]);
    expect(list[0]).toEqual({
      id: "pier.a",
      name: "Ada",
      version: "1.2.0",
    });
  });

  it("returns empty when official mutations disallowed or catalog missing", () => {
    expect(
      listUpdatableManagedPlugins(
        snap([row({ id: "pier.a" })], { officialMutationsAllowed: false }),
        false
      )
    ).toEqual([]);
    expect(listUpdatableManagedPlugins(null, true)).toEqual([]);
  });
});

describe("runManagedPluginUpdateAll", () => {
  it("runs serially and continues after failure", async () => {
    const order: string[] = [];
    const update = vi.fn(async (id: string) => {
      order.push(id);
      if (id === "pier.a") {
        return { ok: false as const, error: { message: "network down" } };
      }
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: true,
        version: "1.1.0",
      };
    });
    const onProgress = vi.fn();
    const result = await runManagedPluginUpdateAll({
      targets: [
        { id: "pier.a", name: "Ada", version: "1.1.0" },
        { id: "pier.b", name: "Bea", version: "1.1.0" },
      ],
      update,
      onProgress,
    });
    expect(order).toEqual(["pier.a", "pier.b"]);
    expect(result.successes).toEqual([{ id: "pier.b", name: "Bea" }]);
    expect(result.failures).toEqual([
      { id: "pier.a", name: "Ada", message: "network down" },
    ]);
    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("treats thrown errors as failures", async () => {
    const result = await runManagedPluginUpdateAll({
      targets: [{ id: "pier.a", name: "Ada", version: "1.1.0" }],
      update: async () => {
        throw new Error("boom");
      },
    });
    expect(result.failures[0]?.message).toBe("boom");
    expect(result.successes).toEqual([]);
  });
});

describe("formatManagedPluginUpdateAllAlertBody", () => {
  it("joins success summary and failure lines", () => {
    const body = formatManagedPluginUpdateAllAlertBody({
      successCount: 1,
      successSummaryLabel: "1 updated.",
      failures: [{ id: "pier.a", name: "Ada", message: "network down" }],
    });
    expect(body).toContain("1 updated.");
    expect(body).toContain("Ada: network down");
  });
});
