import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
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
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useWorktreePreferencesStore } from "@/stores/worktree-preferences.store.ts";

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
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

const WORKTREE_INITIAL_STATE = {
  worktreeRootPath: "",
};

function gitEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: GIT_PLUGIN_MANIFEST,
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

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
      read: vi.fn(async () => ({
        worktreeRootPath: "/existing/worktrees",
      })),
      update: vi.fn(async (patch: { worktreeRootPath?: string }) => ({
        worktreeRootPath: patch.worktreeRootPath ?? "/existing/worktrees",
      })),
    },
    settings: {
      onOpenRequest: vi.fn(() => () => undefined),
    },
  };
}

describe("SettingsDialog — Workspace section owns Worktree preferences", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    useWorktreePreferencesStore.setState(WORKTREE_INITIAL_STATE);
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
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    useWorktreePreferencesStore.setState(WORKTREE_INITIAL_STATE);
  });

  it("does not render a top-level Worktree settings nav item", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "appearance",
        isOpen: true,
      });
    });

    render(<SettingsDialog />);

    expect(
      screen.queryByTestId("settings-nav-worktree")
    ).not.toBeInTheDocument();
  });

  it("renders Worktree Directory in the Workspace section and writes through project preferences", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    useWorktreePreferencesStore.setState({
      worktreeRootPath: "/existing/worktrees",
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "workspace",
        isOpen: true,
      });
    });

    render(<SettingsDialog />);

    expect(
      screen.getByRole("heading", { name: "Workspace" })
    ).toBeInTheDocument();
    const worktreeInput = screen.getByRole("textbox", {
      name: "Worktree Directory",
    });
    expect(
      screen.getByText(
        "Leave empty to use a {project}.worktree directory next to the main project."
      )
    ).toBeInTheDocument();
    expect(worktreeInput).toHaveValue("/existing/worktrees");

    fireEvent.change(worktreeInput, {
      target: { value: "  /Volumes/pier-worktrees  " },
    });
    fireEvent.blur(worktreeInput);

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        worktreeRootPath: "/Volumes/pier-worktrees",
      });
    });
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalledWith(
      "worktreeRootPath",
      expect.anything()
    );
  });

  it("navigates to the Workspace section from the sidebar nav item", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "appearance",
        isOpen: true,
      });
    });

    render(<SettingsDialog />);

    fireEvent.click(screen.getByTestId("settings-nav-workspace"));

    expect(
      screen.getByRole("textbox", { name: "Worktree Directory" })
    ).toBeInTheDocument();
  });

  it("no longer renders Worktree Directory on the built-in Git settings page", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.git",
        isOpen: true,
      });
    });

    render(<SettingsDialog />);

    expect(
      screen.queryByRole("textbox", { name: "Worktree Directory" })
    ).not.toBeInTheDocument();
  });

  it("does not render the removed Branch Prefix setting on the built-in Git settings page", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    useWorktreePreferencesStore.setState({
      worktreeBranchPrefix: "legacy/",
      worktreeRootPath: "/existing/worktrees",
    } as never);
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.git",
        isOpen: true,
      });
    });

    render(<SettingsDialog />);

    expect(
      screen.queryByRole("textbox", { name: "Branch Prefix" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Prefix added before generated worktree branch names; leave empty for no prefix."
      )
    ).not.toBeInTheDocument();
  });
});
