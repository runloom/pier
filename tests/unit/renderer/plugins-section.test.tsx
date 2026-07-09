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
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

const INITIAL_STORE_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const MISSION_CONTROL_WIDGETS_SUMMARY_RE = /2 Mission Control widgets/i;

describe("PluginsSection", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(INITIAL_STORE_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable: vi.fn(async () => entry("pier.git", false)),
          enable: vi.fn(async () => entry("pier.git", true)),
          list: vi.fn(async () => ({
            diagnostics: [],
            entries: [entry("pier.git", false)],
          })),
          onChanged: vi.fn(() => () => undefined),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(INITIAL_STORE_STATE);
    useSettingsDialogStore.setState({ activeSection: "appearance" });
  });

  it("store 未初始化时渲染 loading 骨架", () => {
    render(<PluginsSection />);
    expect(screen.getByTestId("plugins-loading")).toBeInTheDocument();
  });

  it("渲染 store 中的插件行, 挂载时不自行发起 list 拉取", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    const { container } = render(<PluginsSection />);
    expect(screen.getByTestId("plugin-row-pier.git")).toBeInTheDocument();
    expect(window.pier.plugins.list).not.toHaveBeenCalled();
    const content = container.querySelector('[data-slot="card-content"]');
    expect(content).toHaveClass("px-0");
    expect(content).not.toHaveClass("py-(--card-spacing)");
  });

  it("store 更新时(模拟广播落地)行随之更新", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);
    expect(screen.queryByTestId("plugin-row-pier.extra")).toBeNull();

    act(() => {
      usePluginRegistryStore.setState({
        plugins: [entry("pier.git", true), entry("pier.extra", true)],
      });
    });
    expect(screen.getByTestId("plugin-row-pier.extra")).toBeInTheDocument();
  });

  it("toggle 调用 disable 并 refresh store", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Disable pier.git" }));

    await waitFor(() => {
      expect(window.pier.plugins.disable).toHaveBeenCalledWith("pier.git");
      // toggle resolve 后显式 refresh() → 恰好一次 list 拉取
      expect(window.pier.plugins.list).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(usePluginRegistryStore.getState().plugins[0]?.enabled).toBe(false);
    });
  });

  it("声明 configuration 的插件行渲染 Settings 内链, 点击跳转到插件 section", () => {
    const withConfiguration: PluginRegistryEntry = {
      ...entry("pier.git", true),
      manifest: {
        ...entry("pier.git", true).manifest,
        configuration: {
          properties: {
            "pier.git.example": { default: true, type: "boolean" },
          },
        },
      },
    };
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [withConfiguration],
    });
    render(<PluginsSection />);

    fireEvent.click(screen.getByTestId("plugin-settings-link-pier.git"));

    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.git"
    );
  });

  it("未声明 configuration 的插件行不渲染 Settings 内链", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);

    expect(
      screen.queryByTestId("plugin-settings-link-pier.git")
    ).not.toBeInTheDocument();
  });

  it("runtime.enabled=false 时(即使 manifest.configuration 存在)不渲染 Settings 内链", () => {
    const disabledWithConfiguration: PluginRegistryEntry = {
      ...entry("pier.git", false),
      manifest: {
        ...entry("pier.git", false).manifest,
        configuration: {
          properties: {
            "pier.git.example": { default: true, type: "boolean" },
          },
        },
      },
      runtime: { canToggle: true, enabled: false, kind: "builtin" },
    };
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [disabledWithConfiguration],
    });
    render(<PluginsSection />);

    expect(
      screen.queryByTestId("plugin-settings-link-pier.git")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("contributionSummary 显示 missionControlWidgets 计数", () => {
    const e = entry("pier.dash", true);
    e.manifest.missionControlWidgets = [
      { id: "w1", permissions: [], title: "W1" },
      { id: "w2", permissions: [], title: "W2" },
    ];
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [e],
    });

    render(<PluginsSection />);

    const pluginRow = screen.getByText("pier.dash");
    fireEvent.click(pluginRow);

    expect(
      screen.getByText(MISSION_CONTROL_WIDGETS_SUMMARY_RE)
    ).toBeInTheDocument();
  });
});
