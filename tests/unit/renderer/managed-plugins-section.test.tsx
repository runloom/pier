import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ManagedPluginsSection } from "@/pages/settings/components/managed-plugins-section.tsx";

function externalEntry(enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      name: "Codex",
      panels: [],
      permissions: [],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled,
      kind: "external",
      rendererEntryUrl: "pier-plugin://pier.codex/1.0.0/dist/renderer.js",
    },
  };
}

function catalog(enabled: boolean): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    plugins: [
      {
        desired: { enabled, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Codex",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.codex",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: enabled ? null : { kind: "disable" },
        update: null,
      },
    ],
  };
}

describe("ManagedPluginsSection", () => {
  beforeEach(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses managed enable/disable commands and refreshes catalog for managed rows", async () => {
    const disable = vi.fn(async () => ({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce(catalog(true))
      .mockResolvedValueOnce(catalog(false));
    const onToggleBuiltin = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        managedPlugins: {
          checkUpdates: vi.fn(async () => catalog(true)),
          disable,
          enable: vi.fn(),
          install: vi.fn(),
          list,
          rollback: vi.fn(),
          uninstall: vi.fn(),
        },
      },
    });

    render(
      <ManagedPluginsSection
        builtinEntries={[externalEntry(true)]}
        builtinInitialized
        onToggleBuiltin={onToggleBuiltin}
        pendingBuiltinId={null}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Disable Codex" })
    );

    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith("pier.codex");
      expect(list).toHaveBeenCalledTimes(2);
    });
    expect(onToggleBuiltin).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Restart Pier Now" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Enable Codex" })
    ).toBeInTheDocument();
  });
});
