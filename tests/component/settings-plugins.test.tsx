import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function pluginEntry(overrides: {
  description?: string;
  enabled: boolean;
  effectivePermissions?: PierCapability[];
  id: string;
  locales?: PluginRegistryEntry["manifest"]["locales"];
  name: string;
  sourceKind: "builtin" | "local";
}): PluginRegistryEntry {
  const commands: PluginRegistryEntry["manifest"]["commands"] = [
    {
      id: `${overrides.id}.list`,
      permissions: ["worktree:read"],
      title: "List Worktrees",
    },
  ];
  return {
    effectivePermissions: overrides.effectivePermissions ?? [
      "plugin:read",
      "worktree:read",
    ],
    enabled: overrides.enabled,
    manifest: {
      apiVersion: 1,
      commands,
      ...(overrides.description ? { description: overrides.description } : {}),
      engines: { pier: ">=0.1.0" },
      id: overrides.id,
      ...(overrides.locales ? { locales: overrides.locales } : {}),
      name: overrides.name,
      panels: [],
      permissions: ["plugin:read"],
      source: { kind: overrides.sourceKind },
      terminalStatusItems: [
        {
          id: `${overrides.id}.status`,
          permissions: ["worktree:read"],
          title: "Worktree Status",
        },
      ],
      version: "1.0.0",
    },
    runtime:
      overrides.sourceKind === "builtin"
        ? {
            canToggle: true,
            enabled: overrides.enabled,
            kind: "builtin" as const,
          }
        : {
            canToggle: false,
            disabledReason: "Local plugins are manifest-only in this version.",
            enabled: false,
            kind: "manifest-only" as const,
          },
  };
}

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

describe("Settings plugins section", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("en");
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    useSettingsDialogStore.setState({ isOpen: true });
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useSettingsDialogStore.setState({ isOpen: false });
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
  });

  it("插件列表始终以摘要行展示：名称/状态/来源/计数摘要，不含底层 ID、命令表或权限明细", async () => {
    const enabledWorktree = pluginEntry({
      enabled: true,
      id: "pier.worktree",
      name: "Worktree",
      sourceKind: "builtin",
    });
    const disabledWorktree = pluginEntry({
      enabled: false,
      id: "pier.worktree",
      name: "Worktree",
      sourceKind: "builtin",
    });
    const localPlugin = pluginEntry({
      enabled: false,
      id: "local.example",
      name: "Local Example",
      sourceKind: "local",
    });
    const list = vi.fn().mockResolvedValueOnce({
      diagnostics: [],
      entries: [disabledWorktree, localPlugin],
    });
    const disable = vi.fn(async () => disabledWorktree);
    const enable = vi.fn();

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable,
          enable,
          inspect: vi.fn(),
          list,
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { applyInputRouting: vi.fn() },
      },
    });
    // 组件不再挂载时自拉取, 而是读取 registry 镜像 store(2b1e7c5);
    // 与 tests/unit/renderer/plugins-section.test.tsx 的播种模式保持一致。
    usePluginRegistryStore.setState({
      diagnostics: [],
      initialized: true,
      plugins: [enabledWorktree, localPlugin],
    });

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Plugins" }));

    expect(await screen.findByText("Worktree")).toBeVisible();
    // builtin 插件不展示 Source badge(方向 D:只有唯一 source 时展示徽章无信息量)。
    expect(screen.queryByText("Built-in")).not.toBeInTheDocument();
    expect(screen.getByText("Local Example")).toBeVisible();
    // non-builtin(local)插件展示 Source badge。
    expect(screen.getByText("Local")).toBeVisible();
    expect(screen.getByText("Manifest preview")).toBeVisible();
    expect(screen.queryByText("pier.worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("pier.worktree.list")).not.toBeInTheDocument();
    expect(screen.queryByText("plugin:read")).not.toBeInTheDocument();
    expect(screen.queryByText("Read plugin manifests")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Read Git worktree information")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show Worktree details" })
    ).not.toBeInTheDocument();

    // 计数摘要行(图标+文案)直接可见, 不需要展开任何详情。
    const worktreeRow = within(screen.getByTestId("plugin-row-pier.worktree"));
    expect(worktreeRow.getByText("1 command")).toBeVisible();
    expect(worktreeRow.getByText("1 terminal status item")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Disable Worktree" }));

    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith("pier.worktree");
    });
    expect(
      await screen.findByRole("button", { name: "Enable Worktree" })
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Enable Local Example" })
    ).not.toBeInTheDocument();
    expect(enable).not.toHaveBeenCalled();
  });

  it("加载插件时使用 shadcn skeleton 加载态", async () => {
    // 组件不再自拉取, loading 态完全由 registry 镜像 store 的 `initialized`
    // 驱动(2b1e7c5); beforeEach 已播种 REGISTRY_INITIAL_STATE(initialized:
    // false), 这里模拟 bootstrap 的 initPluginRegistry()/广播落地把它翻转。
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable: vi.fn(),
          enable: vi.fn(),
          inspect: vi.fn(),
          list: vi.fn(),
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { applyInputRouting: vi.fn() },
      },
    });

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Plugins" }));

    expect(await screen.findByTestId("plugins-loading")).toBeVisible();
    expect(screen.getByText("Loading plugins")).toBeVisible();

    act(() => {
      usePluginRegistryStore.setState({
        diagnostics: [],
        initialized: true,
        plugins: [],
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("plugins-loading")).not.toBeInTheDocument();
    });
  });

  it("中文环境下使用插件 manifest 自带 locale 展示名称、描述和启停按钮", async () => {
    await i18next.changeLanguage("zh-CN");
    const enabledWorktree = pluginEntry({
      description:
        "Built-in worktree command palette and terminal status support.",
      enabled: true,
      id: "pier.worktree",
      locales: {
        "zh-CN": {
          commands: {
            "pier.worktree.list": { title: "工作树列表" },
          },
          description: "提供工作树命令面板入口和终端状态栏支持。",
          name: "工作树",
          terminalStatusItems: {
            "pier.worktree.status": { title: "工作树状态" },
          },
        },
      },
      name: "Worktree",
      sourceKind: "builtin",
    });
    const localPlugin = pluginEntry({
      description: "Local plugin",
      enabled: false,
      id: "local.example",
      locales: {
        "zh-CN": {
          description: "本地示例插件",
          name: "本地示例",
        },
      },
      name: "Local Example",
      sourceKind: "local",
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable: vi.fn(),
          enable: vi.fn(),
          inspect: vi.fn(),
          list: vi.fn(),
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { applyInputRouting: vi.fn() },
      },
    });
    usePluginRegistryStore.setState({
      diagnostics: [],
      initialized: true,
      plugins: [enabledWorktree, localPlugin],
    });

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "插件" }));

    expect(await screen.findByText("工作树")).toBeVisible();
    expect(
      screen.getByText("提供工作树命令面板入口和终端状态栏支持。")
    ).toBeVisible();
    expect(screen.getByText("本地示例")).toBeVisible();
    expect(screen.getByText("本地示例插件")).toBeVisible();
    expect(screen.queryByText("pier.worktree.list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停用工作树" })).toBeVisible();
    expect(screen.getByText("仅清单预览")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "显示工作树详情" })
    ).not.toBeInTheDocument();

    // 命令/状态项标题不再单独展示, 只展示 i18n 计数摘要。
    expect(screen.queryByText("工作树列表")).not.toBeInTheDocument();
    expect(screen.queryByText("工作树状态")).not.toBeInTheDocument();
    const worktreeRow = within(screen.getByTestId("plugin-row-pier.worktree"));
    expect(worktreeRow.getByText("1 个命令")).toBeVisible();
    expect(worktreeRow.getByText("1 个终端状态项")).toBeVisible();
  });
});
