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
  id: string;
  locales?: Record<string, unknown>;
  name: string;
  sourceKind: "builtin" | "local";
}) {
  return {
    commands: [
      {
        id: `${overrides.id}.list`,
        permissions: ["worktree:read"],
        title: "Worktree: List",
      },
    ],
    enabled: overrides.enabled,
    id: overrides.id,
    manifest: {
      apiVersion: 1,
      commands: [],
      ...(overrides.description ? { description: overrides.description } : {}),
      engines: { pier: ">=0.1.0" },
      id: overrides.id,
      ...(overrides.locales ? { locales: overrides.locales } : {}),
      name: overrides.name,
      panels: [],
      permissions: ["plugin:read"],
      source: { kind: overrides.sourceKind },
      version: "1.0.0",
    },
    panels: [],
    permissions: ["plugin:read"],
    source: { kind: overrides.sourceKind },
    version: "1.0.0",
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

  it("展示插件 manifest 信息并支持禁用 builtin 插件", async () => {
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

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          disable,
          enable: vi.fn(),
          inspect: vi.fn(),
          list,
        },
        settings: { onOpenRequest: vi.fn(() => vi.fn()) },
        terminal: { setOverlayActive: vi.fn() },
      },
    });

    render(<SettingsDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Plugins" }));

    expect(await screen.findByText("Worktree")).toBeVisible();
    expect(screen.getByText("pier.worktree")).toBeVisible();
    expect(screen.getByText("Built-in")).toBeVisible();
    expect(screen.getByText("local.example")).toBeVisible();
    expect(screen.getAllByText("Commands")[0]).toBeVisible();
    expect(screen.getByText("pier.worktree.list")).toBeVisible();
    expect(screen.getAllByText("plugin:read")[0]).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Disable Worktree" }));

    await waitFor(() => {
      expect(disable).toHaveBeenCalledWith("pier.worktree");
    });
    expect(
      await screen.findByRole("button", { name: "Enable Worktree" })
    ).toBeVisible();
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
        terminal: { setOverlayActive: vi.fn() },
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
        terminal: { setOverlayActive: vi.fn() },
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
    expect(screen.getByText("工作树列表")).toBeVisible();
    expect(screen.getByText("pier.worktree.list")).toBeVisible();
    expect(screen.getByRole("button", { name: "停用工作树" })).toBeVisible();
  });
});
