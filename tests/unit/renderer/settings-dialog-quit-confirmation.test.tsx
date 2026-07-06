import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { useAppQuitPreferencesStore } from "@/stores/app-quit-preferences.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

const originalScrollIntoView = Element.prototype.scrollIntoView;

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [] as PluginRegistryEntry[],
};

const PLUGIN_SETTINGS_INITIAL_STATE = {
  error: null,
  initialized: false,
  values: {},
};

const DIALOG_INITIAL_STATE = {
  activeSection: "appearance",
  isOpen: false,
};

const TERMINAL_INITIAL_STATE = {
  terminalCursorBlink: true,
  terminalCursorStyle: "block" as const,
  terminalNewCwdPolicy: "activeTerminal" as const,
  terminalPasteProtection: true,
  terminalScrollbackMb: 64,
};

const APP_QUIT_INITIAL_STATE = {
  confirmOnQuit: "hasActivity" as const,
};

function pierMock() {
  return {
    pluginSettings: {
      getAll: vi.fn(async () => ({ values: {}, version: 1 })),
      onChanged: vi.fn(() => () => undefined),
      reset: vi.fn(async () => ({ values: {}, version: 1 })),
      set: vi.fn(async (key: string, value: unknown) => ({
        values: { [key]: value },
        version: 1,
      })),
    },
    preferences: {
      onChanged: vi.fn(() => () => undefined),
      read: vi.fn(async () => makeFakePreferences()),
      update: vi.fn(
        async (patch: { confirmOnQuit?: AppQuitConfirmationMode }) =>
          makeFakePreferences(patch)
      ),
    },
    settings: {
      onOpenRequest: vi.fn(() => () => undefined),
    },
  };
}

function openTerminalSettings(
  initialMode: AppQuitConfirmationMode = "hasActivity"
) {
  useAppQuitPreferencesStore.setState({
    confirmOnQuit: initialMode,
  } as never);
  act(() => {
    useSettingsDialogStore.setState({
      activeSection: "terminal",
      isOpen: true,
    });
  });
  render(<SettingsDialog />);
}

async function chooseQuitConfirmation(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Quit Confirmation" }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("SettingsDialog — Terminal quit confirmation preference", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await initI18n();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    useTerminalPreferencesStore.setState(TERMINAL_INITIAL_STATE as never);
    useAppQuitPreferencesStore.setState(APP_QUIT_INITIAL_STATE as never);
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
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    useTerminalPreferencesStore.setState(TERMINAL_INITIAL_STATE as never);
    useAppQuitPreferencesStore.setState(APP_QUIT_INITIAL_STATE as never);
  });

  it("renders the quit confirmation control and its three user-facing modes", async () => {
    openTerminalSettings();

    expect(
      screen.getByRole("combobox", { name: "Quit Confirmation" })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Quit Confirmation" })
    );

    expect(
      await screen.findByRole("option", { name: "When activity is running" })
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Always" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Never" })).toBeInTheDocument();
  });

  it("persists Always as confirmOnQuit always", async () => {
    openTerminalSettings();

    await chooseQuitConfirmation("Always");

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        confirmOnQuit: "always",
      });
    });
  });

  it("persists When activity is running as confirmOnQuit hasActivity", async () => {
    openTerminalSettings("always");

    await chooseQuitConfirmation("When activity is running");

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        confirmOnQuit: "hasActivity",
      });
    });
  });

  it("persists Never as confirmOnQuit never", async () => {
    openTerminalSettings();

    await chooseQuitConfirmation("Never");

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        confirmOnQuit: "never",
      });
    });
  });
});
