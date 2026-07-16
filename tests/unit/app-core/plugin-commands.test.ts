import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executePluginCommand } from "@main/app-core/plugin-commands.ts";
import { PluginDisableTransitionCoordinator } from "@main/app-core/plugin-disable-transition.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import { describe, expect, it, vi } from "vitest";

describe("plugin command routing", () => {
  it("routes plugin.checkUpdates to the managed refresh operation", async () => {
    const refreshedSnapshot: ManagedPluginCatalogSnapshot = {
      checkedAt: 2,
      officialMutationsAllowed: true,
      pluginMode: "release",
      plugins: [],
    };
    const staleSnapshot: ManagedPluginCatalogSnapshot = {
      checkedAt: 1,
      officialMutationsAllowed: true,
      pluginMode: "release",
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

  it("prepares every renderer before disabling a plugin", async () => {
    const setEnabled = vi.fn(async () => ({ enabled: false }));
    const execute = vi.fn(async (command: { windowId?: string }) => ({
      data: null,
      ok: true as const,
      requestId: `prepare-${command.windowId}`,
    }));
    const services = {
      managedPlugins: { getIndex: () => ({ plugins: {} }) },
      pluginDisableTransitions: new PluginDisableTransitionCoordinator(),
      plugins: { setEnabled },
      rendererCommand: { execute },
      window: {
        list: () => [
          { focused: true, id: "main", recordId: "record-main" },
          { focused: false, id: "w-1", recordId: "record-w-1" },
        ],
      },
    } as unknown as PierCoreServices;

    await executePluginCommand(
      "request-disable",
      { id: "pier.files", type: "plugin.disable" },
      services
    );

    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: 1,
        pluginId: "pier.files",
        transitionId: expect.stringMatching(/^plugin-disable:pier\.files:1:/),
        type: "plugin.prepareDisable",
        windowId: "main",
      })
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: 1,
        outcome: "commit",
        pluginId: "pier.files",
        type: "plugin.finalizeDisable",
        windowId: "main",
      })
    );
    expect(setEnabled).toHaveBeenCalledWith("pier.files", false);
  });

  it("does not persist disabled state when any live renderer vetoes", async () => {
    const setEnabled = vi.fn(async () => ({ enabled: false }));
    const services = {
      managedPlugins: { getIndex: () => ({ plugins: {} }) },
      pluginDisableTransitions: new PluginDisableTransitionCoordinator(),
      plugins: { setEnabled },
      rendererCommand: {
        execute: vi.fn(async () => ({
          error: { message: "draft flush failed" },
          ok: false as const,
          requestId: "prepare-main",
        })),
      },
      window: {
        list: () => [{ focused: true, id: "main", recordId: "record-main" }],
      },
    } as unknown as PierCoreServices;

    await expect(
      executePluginCommand(
        "request-disable",
        { id: "pier.files", type: "plugin.disable" },
        services
      )
    ).rejects.toThrow("plugin disable preparation failed: pier.files");

    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("finalizes a no-op enable as abort so the current runtime resumes", async () => {
    const entry = {
      effectivePermissions: [],
      enabled: true,
      manifest: {
        apiVersion: 1,
        commands: [],
        engines: { pier: ">=0.1.0" },
        id: "pier.external",
        workbenchWidgets: [],
        name: "External",
        panels: [],
        permissions: [],
        settingsPages: [],
        source: { kind: "official" as const },
        terminalStatusItems: [],
        version: "1.0.0",
      },
      runtime: {
        canToggle: true,
        enabled: true,
        kind: "external" as const,
        rendererEntryUrl: "pier-plugin://pier.external/renderer.js",
        sourceRevision: "rev-1",
      },
    };
    const execute = vi.fn(async (command: { windowId?: string }) => ({
      data: null,
      ok: true as const,
      requestId: `transition-${command.windowId}`,
    }));
    const services = {
      managedPlugins: {
        enable: vi.fn(async () => ({ ok: true })),
        getIndex: () => ({ plugins: { "pier.external": {} } }),
      },
      pluginDisableTransitions: new PluginDisableTransitionCoordinator(),
      plugins: { inspect: vi.fn(async () => entry) },
      rendererCommand: { execute },
      window: {
        list: () => [{ focused: true, id: "main", recordId: "record-main" }],
      },
    } as unknown as PierCoreServices;

    await executePluginCommand(
      "request-enable",
      { id: "pier.external", type: "plugin.enable" },
      services
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "abort",
        pluginId: "pier.external",
        type: "plugin.finalizeReload",
      })
    );
  });
});
