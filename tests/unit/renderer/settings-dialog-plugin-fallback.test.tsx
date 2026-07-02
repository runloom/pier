import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function entry(id: string, enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          [`${id}.flag`]: { default: true, type: "boolean" },
        },
        title: `${id} Settings`,
      },
      engines: { pier: ">=0.1.0" },
      id,
      name: `${id}-name`,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
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
      disable: vi.fn(async () => entry("pier.demo", false)),
      enable: vi.fn(async () => entry("pier.demo", true)),
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
      read: vi.fn(async () => ({
        agentCommandOverrides: {},
        agentDefaultArgs: {},
        agentDefaultEnv: {},
        defaultAgentId: null,
        disabledAgentIds: [],
        language: "system",
        stylePreset: "pierre",
        terminalCursorBlink: true,
        terminalCursorStyle: "block",
        terminalNewCwdPolicy: "activeTerminal",
        terminalPasteProtection: true,
        terminalScrollbackMb: 64,
        theme: "system",
        userKeymap: {},
      })),
      update: vi.fn(async (patch: Record<string, unknown>) => patch),
    },
    settings: {
      onOpenRequest: vi.fn(() => () => undefined),
    },
  };
}

describe("SettingsDialog — 插件 section 消失时 fallback 到 plugins", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: pierMock(),
    });
    // SidebarProvider (useIsMobile) 依赖 matchMedia — jsdom 默认不实现。
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
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
  });

  it("插件项在本窗口被禁用(store.plugins 更新)时, activeSection fallback 到 plugins", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo", true)],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    expect(
      screen.getByTestId("settings-nav-plugin-pier.demo")
    ).toBeInTheDocument();
    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.demo"
    );

    // 模拟本窗口禁用插件 —— store.plugins 更新为 disabled。
    act(() => {
      usePluginRegistryStore.setState({
        plugins: [entry("pier.demo", false)],
      });
    });

    expect(useSettingsDialogStore.getState().activeSection).toBe("plugins");
    expect(
      screen.queryByTestId("settings-nav-plugin-pier.demo")
    ).not.toBeInTheDocument();
  });

  it("插件项被其它窗口广播禁用(store.plugins 整体替换)时, activeSection fallback 到 plugins", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo", true), entry("pier.other", true)],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.demo"
    );

    // 模拟其它窗口触发的 PLUGINS_CHANGED 广播落地: usePluginRegistryStore.setState 全量替换。
    act(() => {
      usePluginRegistryStore.setState({
        plugins: [entry("pier.other", true)],
      });
    });

    expect(useSettingsDialogStore.getState().activeSection).toBe("plugins");
  });

  it("插件项仍存在时, activeSection 保持不变", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo", true)],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    act(() => {
      usePluginRegistryStore.setState({
        plugins: [entry("pier.demo", true)],
      });
    });

    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.demo"
    );
  });
});
