import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executePluginCommand } from "@main/app-core/plugin-commands.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import { describe, expect, it, vi } from "vitest";

describe("plugin command routing", () => {
  it("routes plugin.checkUpdates to the managed refresh operation", async () => {
    const refreshedSnapshot: ManagedPluginCatalogSnapshot = {
      checkedAt: 2,
      plugins: [],
    };
    const staleSnapshot: ManagedPluginCatalogSnapshot = {
      checkedAt: 1,
      plugins: [],
    };
    const checkUpdates = vi.fn(async () => refreshedSnapshot);
    const listCatalogSnapshot = vi.fn(async () => staleSnapshot);
    const services = {
      managedPlugins: {
        checkUpdates,
        listCatalogSnapshot,
      },
    } as unknown as PierCoreServices;

    const result = await executePluginCommand(
      "request-1",
      { type: "plugin.checkUpdates" },
      services
    );

    expect(checkUpdates).toHaveBeenCalledTimes(1);
    expect(listCatalogSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: refreshedSnapshot,
      ok: true,
      requestId: "request-1",
    });
  });
});
