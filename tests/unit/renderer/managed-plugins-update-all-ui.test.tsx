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
  info: vi.fn(),
  loading: vi.fn(() => "toast-batch"),
  promise: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
}));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return { ...actual, showAppAlert: appDialogMocks.showAppAlert };
});

function entry(id: string, name: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name,
      panels: [],
      permissions: [],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: `pier-plugin://${id}/1.0.0/dist/renderer.js`,
    },
  };
}

function catalogTwoUpdates(
  extra?: Partial<ManagedPluginCatalogSnapshot>
): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release",
    plugins: [
      {
        desired: { enabled: true, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Ada",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.ada",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: { version: "1.1.0" },
      },
      {
        desired: { enabled: true, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Bea",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.bea",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: { version: "1.2.0" },
      },
    ],
    ...extra,
  };
}

function stubPier(managed: Record<string, unknown>): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: { managedPlugins: managed },
  });
}

describe("ManagedPluginsSection Update All", () => {
  beforeEach(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    toastMocks.loading.mockReset();
    toastMocks.success.mockReset();
    toastMocks.dismiss.mockReset();
    appDialogMocks.showAppAlert.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hides Update All when fewer than two plugins can update", async () => {
    const one = catalogTwoUpdates();
    one.plugins = [one.plugins[0]!];
    stubPier({
      checkUpdates: vi.fn(async () => one),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => one),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: "Update All" })).toBeNull();
  });

  it("shows Update All for two updatable plugins and updates serially", async () => {
    const cat = catalogTwoUpdates();
    const update = vi.fn(async (id: string) => ({
      ok: true as const,
      pluginId: id,
      requiresRestart: true,
      version: "1.1.0",
    }));
    const list = vi.fn(async () => cat);
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list,
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update,
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update All" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("pier.ada");
      expect(update).toHaveBeenCalledWith("pier.bea");
    });
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled();
    });
    // list: initial mount + final refresh
    await waitFor(() => {
      expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("alerts on partial failure and still calls every update", async () => {
    const cat = catalogTwoUpdates();
    const update = vi.fn(async (id: string) => {
      if (id === "pier.ada") {
        return { ok: false as const, error: { message: "network down" } };
      }
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: true,
        version: "1.2.0",
      };
    });
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => cat),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update,
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update All" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
      expect(appDialogMocks.showAppAlert).toHaveBeenCalled();
    });
    const arg = appDialogMocks.showAppAlert.mock.calls[0]?.[0] as {
      title: string;
      body: string;
    };
    expect(arg.title).toMatch(/couldn't be updated|未能更新/i);
    expect(arg.body).toMatch(/Ada/i);
    expect(arg.body).toMatch(/network down/i);
  });

  it("hides Update All when official mutations are disallowed", async () => {
    const cat = catalogTwoUpdates({ officialMutationsAllowed: false });
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => cat),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: "Update All" })).toBeNull();
  });

  it("disables managed enable/disable while Update All runs", async () => {
    const cat = catalogTwoUpdates();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = vi.fn(async (id: string) => {
      await gate;
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: true,
        version: "1.1.0",
      };
    });
    const disable = vi.fn(async () => ({
      ok: true as const,
      pluginId: "pier.ada",
      requiresRestart: true,
    }));
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable,
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => cat),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update,
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    const disableAda = await screen.findByRole("button", {
      name: "Disable Ada",
    });
    expect(disableAda).not.toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Update All" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Disable Ada" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable Bea" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Update All" })).toBeDisabled();
    release();
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Disable Ada" })
      ).not.toBeDisabled();
    });
    expect(disable).not.toHaveBeenCalled();
  });
});
