import type {
  PluginRegistryEntry,
  PluginTerminalStatusItemContribution,
} from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
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
import { TerminalStatusBarBlock } from "@/pages/settings/components/terminal-status-bar-block.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

function statusItem(
  id: string,
  overrides: Partial<PluginTerminalStatusItemContribution> = {}
): PluginTerminalStatusItemContribution {
  return { id, permissions: [], title: id, ...overrides };
}

function entry(
  id: string,
  enabled: boolean,
  terminalStatusItems: PluginTerminalStatusItemContribution[] = []
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems,
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

function emptyPrefs(): TerminalStatusBarPrefs {
  return { items: {}, version: 1 };
}

const INITIAL_PLUGIN_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const INITIAL_PREFS_STATE = {
  error: null,
  initialized: false,
  prefs: emptyPrefs(),
};

describe("TerminalStatusBarBlock", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(INITIAL_PLUGIN_STATE);
    useTerminalStatusBarPrefsStore.setState(INITIAL_PREFS_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          getAll: vi.fn(async () => emptyPrefs()),
          onChanged: vi.fn(() => () => undefined),
          resetItem: vi.fn(async () => emptyPrefs()),
          setItemOverride: vi.fn(async (itemId: string, override) => ({
            items: { [itemId]: override },
            version: 1,
          })),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(INITIAL_PLUGIN_STATE);
    useTerminalStatusBarPrefsStore.setState(INITIAL_PREFS_STATE);
  });

  it("无已启用插件声明状态栏项时渲染空态文案", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByText("Enabled plugins declare no status bar items")
    ).toBeInTheDocument();
  });

  it("禁用插件的状态项不参与展示(空态)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", false, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByText("Enabled plugins declare no status bar items")
    ).toBeInTheDocument();
  });

  it("渲染左侧组单项,无覆盖时不显示已修改徽标", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByTestId("status-bar-row-pier.worktree.status")
    ).toBeInTheDocument();
    expect(screen.getByText("Left")).toBeInTheDocument();
    expect(screen.queryByText("Right")).toBeNull();
    expect(screen.queryByText("Modified")).toBeNull();
  });

  it("单项时上移下移按钮均禁用(组首且组尾)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByRole("button", { name: "Move up (outward)" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move down (inward)" })
    ).toBeDisabled();
  });

  it("关闭显示开关写 hidden:true 覆盖", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);

    fireEvent.click(screen.getByRole("switch", { name: "Visible" }));

    await waitFor(() => {
      expect(
        window.pier.terminalStatusBarPrefs.setItemOverride
      ).toHaveBeenCalledWith("pier.worktree.status", { hidden: true });
    });
  });

  it("点击移到右侧写 alignment:right 覆盖", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);

    fireEvent.click(
      screen.getByRole("button", { name: "Move to right group" })
    );

    await waitFor(() => {
      expect(
        window.pier.terminalStatusBarPrefs.setItemOverride
      ).toHaveBeenCalledWith("pier.worktree.status", { alignment: "right" });
    });
  });

  it("恢复默认按钮在无覆盖时禁用,有覆盖时可点并调用 resetItem", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByRole("button", { name: "Reset to plugin default" })
    ).toBeDisabled();

    act(() => {
      useTerminalStatusBarPrefsStore.setState({
        prefs: {
          items: { "pier.worktree.status": { hidden: true } },
          version: 1,
        },
      });
    });

    expect(screen.getByText("Modified")).toBeInTheDocument();
    const resetButton = screen.getByRole("button", {
      name: "Reset to plugin default",
    });
    expect(resetButton).not.toBeDisabled();
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(window.pier.terminalStatusBarPrefs.resetItem).toHaveBeenCalledWith(
        "pier.worktree.status"
      );
    });
  });

  it("上移把组内第二项与第一项交换,按 normalizedGroupOrders 写差异 order", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [
        entry("pier.git", true, [statusItem("a.item"), statusItem("b.item")]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    // 初始外侧优先序按 id 字典序:a.item(0), b.item(10)
    const upButtons = screen.getAllByRole("button", {
      name: "Move up (outward)",
    });
    // 第二行(b.item)上移到第一位
    fireEvent.click(upButtons[1] as HTMLElement);

    await waitFor(() => {
      // 交换后目标序:b.item, a.item -> b.item order 0(未变,跳过写入不保证),
      // a.item order 变为 10 (原 0 -> 10),两项目标 order 只要有变化即写入。
      expect(
        window.pier.terminalStatusBarPrefs.setItemOverride
      ).toHaveBeenCalledWith("a.item", { order: 10 });
    });
  });

  it("组首项上移按钮禁用,组尾项下移按钮禁用", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [
        entry("pier.git", true, [statusItem("a.item"), statusItem("b.item")]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    const upButtons = screen.getAllByRole("button", {
      name: "Move up (outward)",
    });
    const downButtons = screen.getAllByRole("button", {
      name: "Move down (inward)",
    });
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons.at(-1)).toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
    expect(upButtons.at(-1)).not.toBeDisabled();
  });
});
