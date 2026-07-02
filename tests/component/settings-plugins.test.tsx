import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function pluginEntry(overrides: {
  description?: string;
  enabled: boolean;
  effectivePermissions?: string[];
  id: string;
  locales?: Record<string, unknown>;
  name: string;
  sourceKind: "builtin" | "local";
}) {
  const commands = [
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useSettingsDialogStore.setState({ isOpen: false });
  });

  it("默认列表只展示插件摘要，详情展开后展示诊断信息", async () => {
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
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        diagnostics: [],
        entries: [enabledWorktree, localPlugin],
      })
      .mockResolvedValueOnce({
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

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Plugins" }));

    expect(await screen.findByText("Worktree")).toBeVisible();
    expect(screen.getByText("Built-in")).toBeVisible();
    expect(screen.getByText("Local Example")).toBeVisible();
    expect(screen.getByText("Manifest preview")).toBeVisible();
    expect(screen.queryByText("pier.worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("pier.worktree.list")).not.toBeInTheDocument();
    expect(screen.queryByText("plugin:read")).not.toBeInTheDocument();
    expect(screen.queryByText("Panels")).not.toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show Worktree details" })
    );

    expect(screen.getByText("Plugin ID")).toBeVisible();
    expect(screen.getByText("pier.worktree")).toBeVisible();
    expect(screen.getByText("Commands")).toBeVisible();
    expect(screen.getByText("pier.worktree.list")).toBeVisible();
    expect(screen.getByText("Terminal status items")).toBeVisible();
    expect(screen.getByText("pier.worktree.status")).toBeVisible();
    expect(screen.getByText("Read plugin manifests")).toBeVisible();
    expect(screen.getByText("Read Git worktree information")).toBeVisible();

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
    let resolveList: (
      result: Awaited<ReturnType<typeof window.pier.plugins.list>>
    ) => void = () => undefined;
    const list = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof window.pier.plugins.list>>>(
          (resolve) => {
            resolveList = resolve;
          }
        )
    );

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable: vi.fn(),
          enable: vi.fn(),
          inspect: vi.fn(),
          list,
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { applyInputRouting: vi.fn() },
      },
    });

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Plugins" }));

    expect(await screen.findByTestId("plugins-loading")).toBeVisible();
    expect(screen.getByText("Loading plugins")).toBeVisible();

    resolveList({ diagnostics: [], entries: [] });
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
    const list = vi.fn().mockResolvedValue({
      diagnostics: [],
      entries: [enabledWorktree, localPlugin],
    });

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable: vi.fn(),
          enable: vi.fn(),
          inspect: vi.fn(),
          list,
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { applyInputRouting: vi.fn() },
      },
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

    fireEvent.click(screen.getByRole("button", { name: "显示工作树详情" }));

    expect(screen.getByText("工作树列表")).toBeVisible();
    expect(screen.getByText("工作树状态")).toBeVisible();
    expect(screen.getByText("读取 Git 工作树信息")).toBeVisible();
  });
});
