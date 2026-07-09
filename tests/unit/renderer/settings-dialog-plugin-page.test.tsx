import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  clearPluginSettingsPagesForTests,
  registerPluginSettingsPage,
} from "@/lib/plugins/plugin-settings-page-registry.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

function entry(id: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          [`${id}.enabledFlag`]: {
            default: true,
            description: "Boolean flag",
            type: "boolean",
          },
        },
        title: `${id} Settings`,
      },
      engines: { pier: ">=0.1.0" },
      id,
      missionControlWidgets: [],
      name: `${id}-name`,
      panels: [],
      permissions: [],
      settingsPages: [{ id: `${id}.page` }],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const SETTINGS_INITIAL_STATE = {
  error: null,
  initialized: false,
  values: {},
};

const DIALOG_INITIAL_STATE = {
  activeSection: "appearance",
  isOpen: false,
};

function pierMock() {
  return {
    agents: {
      detect: vi.fn(async () => ({ detectedIds: [] })),
      refresh: vi.fn(async () => ({ detectedIds: [] })),
    },
    onWindowLayoutPulse: vi.fn(() => () => undefined),
    plugins: {
      disable: vi.fn(async () => entry("pier.demo")),
      enable: vi.fn(async () => entry("pier.demo")),
      list: vi.fn(async () => ({ diagnostics: [], entries: [] })),
      onChanged: vi.fn(() => () => undefined),
    },
    pluginSettings: {
      getAll: vi.fn(async () => ({ values: {}, version: 1 })),
      onChanged: vi.fn(() => () => undefined),
      reset: vi.fn(async () => ({ values: {}, version: 1 })),
      set: vi.fn(async () => ({ values: {}, version: 1 })),
    },
    preferences: {
      onChanged: vi.fn(() => () => undefined),
      read: vi.fn(() => Promise.resolve(makeFakePreferences())),
      update: vi.fn((patch: Parameters<typeof makeFakePreferences>[0]) =>
        Promise.resolve(makeFakePreferences(patch))
      ),
    },
    settings: {
      onOpenRequest: vi.fn(() => () => undefined),
    },
  };
}

describe("SettingsDialog — custom plugin settings page", () => {
  beforeEach(async () => {
    await initI18n();
    clearPluginSettingsPagesForTests();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: pierMock(),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearPluginSettingsPagesForTests();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
  });

  it("renders a registered custom page instead of PluginConfigurationSection", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    registerPluginSettingsPage("pier.demo", {
      id: "pier.demo.page",
      component: () => (
        <div data-testid="custom-plugin-settings-page">Custom page</div>
      ),
    });

    act(() => {
      useSettingsDialogStore.getState().openSection("plugin:pier.demo");
    });
    render(<SettingsDialog />);

    expect(
      screen.getByTestId("custom-plugin-settings-page")
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("re-renders when a custom page registers after the dialog is open", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    act(() => {
      useSettingsDialogStore.getState().openSection("plugin:pier.demo");
    });
    render(<SettingsDialog />);

    expect(screen.getByRole("switch")).toBeInTheDocument();

    act(() => {
      registerPluginSettingsPage("pier.demo", {
        id: "pier.demo.page",
        component: () => (
          <div data-testid="custom-plugin-settings-page">Custom page</div>
        ),
      });
    });

    expect(
      screen.getByTestId("custom-plugin-settings-page")
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
