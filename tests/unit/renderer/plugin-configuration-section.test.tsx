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
import { PluginConfigurationSection } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

function entry(id: string, enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
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
          [`${id}.limit`]: {
            default: 10,
            description: "Numeric limit",
            maximum: 20,
            minimum: 1,
            order: 3,
            type: "number",
          },
          [`${id}.mode`]: {
            default: "fast",
            description: "Mode select",
            enum: ["fast", "slow"],
            enumDescriptions: ["Fast mode", "Slow mode"],
            order: 2,
            type: "string",
          },
          [`${id}.name`]: {
            default: "default-name",
            description: "Free text",
            order: 1,
            type: "string",
          },
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

describe("PluginConfigurationSection", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        pluginSettings: {
          getAll: vi.fn(async () => ({ values: {}, version: 1 })),
          onChanged: vi.fn(() => () => undefined),
          reset: vi.fn(async (key: string) => ({
            values: { [key]: undefined },
            version: 1,
          })),
          set: vi.fn(async (key: string, value: unknown) => ({
            values: { [key]: value },
            version: 1,
          })),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
  });

  it("插件不存在或未声明 configuration 时不渲染", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [],
    });
    const { container } = render(
      <PluginConfigurationSection pluginId="pier.missing" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("四类控件全部渲染: boolean→switch, enum→select, string→input, number→input[number]", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    const nameInput = screen.getByDisplayValue("default-name");
    expect(nameInput).toHaveAttribute("type", "text");

    const limitInput = screen.getByDisplayValue("10");
    expect(limitInput).toHaveAttribute("type", "number");
    expect(limitInput).toHaveAttribute("min", "1");
    expect(limitInput).toHaveAttribute("max", "20");
  });

  it("boolean 控件切换即写入对应 key", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.enabledFlag",
        false
      );
    });
  });

  it("number 控件 blur 提交并按 min/max clamp", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const limitInput = screen.getByDisplayValue("10");
    fireEvent.change(limitInput, { target: { value: "999" } });
    fireEvent.blur(limitInput);

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.limit",
        20
      );
    });
  });

  it("string 控件 blur 提交原始值", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const nameInput = screen.getByDisplayValue("default-name");
    fireEvent.change(nameInput, { target: { value: "custom-name" } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.name",
        "custom-name"
      );
    });
  });

  it("已修改值显示已修改标记, 点击恢复默认调用 reset", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.demo.enabledFlag": false },
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    expect(screen.getByText("Modified")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    await waitFor(() => {
      expect(window.pier.pluginSettings.reset).toHaveBeenCalledWith(
        "pier.demo.enabledFlag"
      );
    });
  });

  it("未修改值不显示已修改标记", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);
    expect(screen.queryByText("Modified")).toBeNull();
  });
});
