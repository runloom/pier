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

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  promise: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

function externalEntry(enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
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

function catalogWithUpdate(): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
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
        update: { version: "1.0.1" },
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
    toastMocks.error.mockReset();
    toastMocks.promise.mockReset();
    toastMocks.success.mockReset();
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

  it("uses the managed update command for managed rows with available updates", async () => {
    const install = vi.fn(async () => ({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
      version: "1.0.1",
    }));
    const update = vi.fn(async () => ({
      ok: true,
      pluginId: "pier.codex",
      requiresRestart: true,
      version: "1.0.1",
    }));
    const list = vi.fn().mockResolvedValue(catalogWithUpdate());
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        managedPlugins: {
          checkUpdates: vi.fn(async () => catalogWithUpdate()),
          disable: vi.fn(),
          enable: vi.fn(),
          install,
          list,
          rollback: vi.fn(),
          uninstall: vi.fn(),
          update,
        },
      },
    });

    render(
      <ManagedPluginsSection
        builtinEntries={[externalEntry(true)]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("pier.codex");
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("renders plugin tabs without counts and keeps check updates as an icon button on the tab row", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        managedPlugins: {
          checkUpdates: vi.fn(async () => catalog(true)),
          disable: vi.fn(),
          enable: vi.fn(),
          install: vi.fn(),
          list: vi.fn(async () => catalog(true)),
          rollback: vi.fn(),
          uninstall: vi.fn(),
          update: vi.fn(),
        },
      },
    });

    render(
      <ManagedPluginsSection
        builtinEntries={[externalEntry(true)]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );

    const installedTab = await screen.findByRole("tab", { name: "Installed" });
    expect(installedTab).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Installed\s*·/ })
    ).not.toBeInTheDocument();

    const checkButton = screen.getByRole("button", {
      name: "Check for Updates",
    });
    expect(checkButton).toHaveTextContent("");
    expect(screen.getByRole("tablist").parentElement).toContainElement(
      checkButton
    );
  });

  it("spins the check updates icon while pending and shows a success toast", async () => {
    let resolveCheck:
      | ((snapshot: ManagedPluginCatalogSnapshot) => void)
      | undefined;
    const checkUpdates = vi.fn(
      () =>
        new Promise<ManagedPluginCatalogSnapshot>((resolve) => {
          resolveCheck = resolve;
        })
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        managedPlugins: {
          checkUpdates,
          disable: vi.fn(),
          enable: vi.fn(),
          install: vi.fn(),
          list: vi.fn(async () => catalog(true)),
          rollback: vi.fn(),
          uninstall: vi.fn(),
          update: vi.fn(),
        },
      },
    });

    render(
      <ManagedPluginsSection
        builtinEntries={[externalEntry(true)]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );

    const checkButton = await screen.findByRole("button", {
      name: "Check for Updates",
    });
    fireEvent.click(checkButton);

    expect(checkButton).toBeDisabled();
    expect(checkButton.querySelector("svg")).toHaveClass("animate-spin");

    resolveCheck?.(catalogWithUpdate());

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith("Plugin updates checked");
    });
  });

  it("shows an error toast when check updates fails", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        managedPlugins: {
          checkUpdates: vi.fn(async () => {
            throw new Error("network down");
          }),
          disable: vi.fn(),
          enable: vi.fn(),
          install: vi.fn(),
          list: vi.fn(async () => catalog(true)),
          rollback: vi.fn(),
          uninstall: vi.fn(),
          update: vi.fn(),
        },
      },
    });

    render(
      <ManagedPluginsSection
        builtinEntries={[externalEntry(true)]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Check for Updates" })
    );

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith(
        "Failed to check plugin updates",
        { description: "network down" }
      );
    });
  });
});
