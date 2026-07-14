import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { PluginConfigurationSection } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
}));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert: appDialogMocks.showAppAlert,
  };
});

function entry(id: string, enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
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

function multilineEntry(id: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      configuration: {
        properties: {
          [`${id}.prompt`]: {
            default: "",
            description: "Prompt template",
            multiline: true,
            placeholder: "Prompt placeholder",
            resettable: false,
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
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
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
    appDialogMocks.showAppAlert.mockClear();
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

  it("number 控件 blur 提交空值时不写入, 输入框显示值回弹为当前 effective(F2)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const limitInput = screen.getByDisplayValue("10");

    // JSDOM 对 type=number 输入非数字文本会拒绝写入, value 变为 ""。
    // raw="" trim 后为空 → 不应按 Number("")=0 处理, 应直接回退到当前 effective(10), 不写入。
    fireEvent.change(limitInput, { target: { value: "" } });
    fireEvent.blur(limitInput);

    // 展示值必须回弹为 effective(10)，不能停留在空字符串，也不能被 clamp 到 min。
    await waitFor(() => {
      expect(limitInput).toHaveValue(10);
    });
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
  });

  it("number 控件 blur 提交值 clamp 后与当前 effective 相同(no-op)时, 输入框显示值仍回弹为 effective", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    // effective 卡在 min 边界(1)，此时空输入 clamp 结果(1)与 effective 相同 → no-op 提交。
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.demo.limit": 1 },
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const limitInput = screen.getByDisplayValue("1");
    fireEvent.change(limitInput, { target: { value: "" } });
    fireEvent.blur(limitInput);

    // no-op: 不写入，但展示值必须回弹为 effective(1)，不能停留在空字符串。
    await waitFor(() => {
      expect(limitInput).toHaveValue(1);
    });
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
  });

  it("string 控件 Enter 提交, 与 blur 走相同提交路径(F10)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const nameInput = screen.getByDisplayValue("default-name");
    nameInput.focus();
    fireEvent.change(nameInput, { target: { value: "enter-name" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.name",
        "enter-name"
      );
    });
  });

  it("number 控件 Enter 提交并 clamp(F10)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const limitInput = screen.getByDisplayValue("10");
    limitInput.focus();
    fireEvent.change(limitInput, { target: { value: "999" } });
    fireEvent.keyDown(limitInput, { key: "Enter" });

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.limit",
        20
      );
    });
  });

  it("string 控件不消费 Escape，由所属弹层决定关闭行为", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const nameInput = screen.getByDisplayValue("default-name");
    fireEvent.change(nameInput, { target: { value: "unsaved-draft" } });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(nameInput, event);

    expect(event.defaultPrevented).toBe(false);
    expect(nameInput).toHaveValue("unsaved-draft");
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
  });

  it("组件 unmount 时若草稿未提交则 flush 写入(F10)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    const { unmount } = render(
      <PluginConfigurationSection pluginId="pier.demo" />
    );

    const nameInput = screen.getByDisplayValue("default-name");
    fireEvent.change(nameInput, { target: { value: "flush-on-unmount" } });
    // 不触发 blur/Enter, 直接卸载。
    unmount();

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.name",
        "flush-on-unmount"
      );
    });
  });

  it("blur 提交后 IPC 未 resolve 时立即 unmount, 不重复提交同值(F10 Critical 回归)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    // IPC 永不 resolve, 模拟 blur 触发的 set 调用还在飞行中、store 的 effective
    // 未及时跟上 —— 此时 unmount cleanup 不应把"刚提交的值"误判成"未提交的草稿"
    // 而再次调用 onCommit/set。
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
          set: vi.fn(() => new Promise(() => undefined)),
        },
      },
    });

    const { unmount } = render(
      <PluginConfigurationSection pluginId="pier.demo" />
    );

    const nameInput = screen.getByDisplayValue("default-name");
    fireEvent.change(nameInput, { target: { value: "committed-name" } });
    fireEvent.blur(nameInput);
    // 同一 tick 内立即 unmount, IPC 尚未 resolve, store.values 未更新, effective 未跟上。
    unmount();

    expect(window.pier.pluginSettings.set).toHaveBeenCalledTimes(1);
    expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
      "pier.demo.name",
      "committed-name"
    );
  });

  it("外部 effective 更新后卸载不会重复提交已同步值", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    const { unmount } = render(
      <PluginConfigurationSection pluginId="pier.demo" />
    );

    act(() => {
      usePluginSettingsStore.setState({
        error: null,
        initialized: true,
        values: { "pier.demo.name": "external-name" },
      });
    });
    await screen.findByDisplayValue("external-name");
    unmount();

    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
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

  it("multiline string setting renders textarea and commits on blur", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [multilineEntry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const textarea = screen.getByRole("textbox", { name: "prompt" });
    expect(textarea).toHaveAttribute("placeholder", "Prompt placeholder");
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).not.toBeInTheDocument();
    fireEvent.change(textarea, {
      target: { value: "Use feature/* for {{task}}" },
    });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
        "pier.demo.prompt",
        "Use feature/* for {{task}}"
      );
    });
  });

  it("string 控件 blur 提交值与 effective 相同(no-op)时, 输入框显示值仍回弹为 effective", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    const nameInput = screen.getByDisplayValue("default-name");
    fireEvent.change(nameInput, { target: { value: "default-name" } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(nameInput).toHaveValue("default-name");
    });
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
  });

  it("写入失败时 store.error 非空, 触发 showAppAlert 提示", async () => {
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
          set: vi.fn(() => {
            throw new Error("ipc boom");
          }),
        },
      },
    });
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(usePluginSettingsStore.getState().error).toBe("ipc boom");
    });
    await waitFor(() => {
      expect(appDialogMocks.showAppAlert).toHaveBeenCalledWith({
        body: "ipc boom",
        title: "Failed to update setting",
      });
    });
  });

  it("用户覆盖值不显示已修改标记和恢复默认按钮", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.demo.enabledFlag": false },
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    expect(screen.queryByText("Modified")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).not.toBeInTheDocument();
    expect(window.pier.pluginSettings.reset).not.toHaveBeenCalled();
  });

  it("覆盖值与 default 相同时仍不显示已修改标记和恢复默认按钮", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.demo.enabledFlag": true },
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    expect(screen.queryByText("Modified")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).not.toBeInTheDocument();
  });

  it("未修改值不显示已修改标记和恢复默认按钮", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    render(<PluginConfigurationSection pluginId="pier.demo" />);

    expect(screen.queryByText("Modified")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).not.toBeInTheDocument();
    expect(window.pier.pluginSettings.reset).not.toHaveBeenCalled();
  });
});
