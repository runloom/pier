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
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { TerminalStatusBarBlock } from "@/pages/settings/components/terminal-status-bar-block.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

const showAppAlert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert,
  };
});

function statusItem(
  id: string,
  overrides: Partial<PluginTerminalStatusItemContribution> = {}
): PluginTerminalStatusItemContribution {
  return { id, permissions: [], title: id, ...overrides };
}

function entry(
  id: string,
  enabled: boolean,
  terminalStatusItems: PluginTerminalStatusItemContribution[] = [],
  runtimeEnabled: boolean = enabled
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems,
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: runtimeEnabled, kind: "builtin" },
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
    showAppAlert.mockClear();
    usePluginRegistryStore.setState(INITIAL_PLUGIN_STATE);
    useTerminalStatusBarPrefsStore.setState(INITIAL_PREFS_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          applyOverrides: vi.fn(async (patches) => ({
            items: patches,
            version: 1,
          })),
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

  it("无已启用插件声明状态栏项时不渲染空态文案(core 声明恒存在)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [])],
    });
    render(<TerminalStatusBarBlock />);
    // core 声明表恒含 core.agent-status,列表不再是「空」——空态文案不出现,
    // 该行渲染但没有任何 plugin 声明的行。
    expect(
      screen.queryByText("Enabled plugins declare no status bar items")
    ).toBeNull();
    expect(
      screen.getByTestId("status-bar-row-core.agent-status")
    ).toBeInTheDocument();
  });

  it("禁用插件的状态项不参与展示(仅剩 core 行)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", false, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.queryByTestId("status-bar-row-pier.worktree.status")
    ).toBeNull();
    expect(
      screen.getByTestId("status-bar-row-core.agent-status")
    ).toBeInTheDocument();
  });

  it("F12:enabled 与 runtime.enabled 漂移时以 runtime.enabled 为准(顶层 enabled=false 但运行时已激活仍展示)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [
        entry(
          "pier.git",
          false,
          [statusItem("pier.worktree.status")],
          /* runtimeEnabled */ true
        ),
      ],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.getByTestId("status-bar-row-pier.worktree.status")
    ).toBeInTheDocument();
  });

  it("F12:顶层 enabled=true 但 runtime.enabled=false 时不展示", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [
        entry(
          "pier.git",
          true,
          [statusItem("pier.worktree.status")],
          /* runtimeEnabled */ false
        ),
      ],
    });
    render(<TerminalStatusBarBlock />);
    expect(
      screen.queryByTestId("status-bar-row-pier.worktree.status")
    ).toBeNull();
    expect(
      screen.getByTestId("status-bar-row-core.agent-status")
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

  it("单项时上移下移按钮均禁用(组首且组尾)(M2: aria-disabled 而非原生 disabled,按钮仍挂载可聚焦)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      // core.agent-status 恒声明在左组(order -10),把插件项放到右组以保持
      // 「组内单项」的测试前提不受 core 行影响(core 与本项分属不同组)。
      plugins: [
        entry("pier.git", true, [
          statusItem("pier.worktree.status", { alignment: "right" }),
        ]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    const upButton = within(pluginRow).getByRole("button", {
      name: "Move up (outward)",
    });
    const downButton = within(pluginRow).getByRole("button", {
      name: "Move down (inward)",
    });
    expect(upButton).toHaveAttribute("aria-disabled", "true");
    expect(upButton).not.toBeDisabled();
    expect(downButton).toHaveAttribute("aria-disabled", "true");
    expect(downButton).not.toBeDisabled();

    // 仍可聚焦(未被原生 disabled 挡在 tab 序列外),点击被 onClick 内部短路。
    upButton.focus();
    expect(document.activeElement).toBe(upButton);
    fireEvent.click(upButton);
    fireEvent.click(downButton);
    expect(
      window.pier.terminalStatusBarPrefs.applyOverrides
    ).not.toHaveBeenCalled();
  });

  it("关闭显示开关写 hidden:true 覆盖", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);

    // core.agent-status 行也渲染同名开关,限定在插件行容器内查询避免多命中。
    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    fireEvent.click(within(pluginRow).getByRole("switch", { name: "Visible" }));

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

    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    fireEvent.click(
      within(pluginRow).getByRole("button", { name: "Move to right group" })
    );

    await waitFor(() => {
      expect(
        window.pier.terminalStatusBarPrefs.setItemOverride
      ).toHaveBeenCalledWith("pier.worktree.status", { alignment: "right" });
    });
  });

  it("恢复默认按钮在无覆盖时 aria-disabled(点击不调用 resetItem),有覆盖时可点并调用 resetItem(M2)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);
    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    const idleResetButton = within(pluginRow).getByRole("button", {
      name: "Reset to plugin default",
    });
    expect(idleResetButton).toHaveAttribute("aria-disabled", "true");
    expect(idleResetButton).not.toBeDisabled();
    fireEvent.click(idleResetButton);
    expect(window.pier.terminalStatusBarPrefs.resetItem).not.toHaveBeenCalled();

    act(() => {
      useTerminalStatusBarPrefsStore.setState({
        prefs: {
          items: { "pier.worktree.status": { hidden: true } },
          version: 1,
        },
      });
    });

    expect(within(pluginRow).getByText("Modified")).toBeInTheDocument();
    const resetButton = within(pluginRow).getByRole("button", {
      name: "Reset to plugin default",
    });
    expect(resetButton).toBe(idleResetButton);
    expect(resetButton).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(window.pier.terminalStatusBarPrefs.resetItem).toHaveBeenCalledWith(
        "pier.worktree.status"
      );
    });
  });

  it("点击 Reset 后按钮仍挂载并带 aria-disabled,键盘焦点不跌落 body(M2)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    act(() => {
      useTerminalStatusBarPrefsStore.setState({
        prefs: {
          items: { "pier.worktree.status": { hidden: true } },
          version: 1,
        },
      });
    });
    render(<TerminalStatusBarBlock />);

    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    const resetButton = within(pluginRow).getByRole("button", {
      name: "Reset to plugin default",
    });
    resetButton.focus();
    expect(document.activeElement).toBe(resetButton);

    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(window.pier.terminalStatusBarPrefs.resetItem).toHaveBeenCalledWith(
        "pier.worktree.status"
      );
    });

    // resetItem 的 IPC mock 不会自动回写 store, 用 setState 模拟 reset 成功落地后
    // prefs 清空的那一刻(hasOverride: true → false) —— 断言按钮仍是同一个挂载
    // 节点、aria-disabled 翻转为 true, 且键盘焦点没有因为卸载/重建而跌落到 body。
    act(() => {
      useTerminalStatusBarPrefsStore.setState({
        prefs: { items: {}, version: 1 },
      });
    });

    expect(
      within(pluginRow).getByRole("button", { name: "Reset to plugin default" })
    ).toBe(resetButton);
    expect(resetButton).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(resetButton);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("上移把组内第二项与第一项交换,按 normalizedGroupOrders 以单次批量 IPC 写差异 order(F8)", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      // core.agent-status 恒声明在左组,两个插件项放到右组以隔离 core,
      // 保持「组内两项互换」测试前提的索引不受 core 行影响。
      plugins: [
        entry("pier.git", true, [
          statusItem("a.item", { alignment: "right" }),
          statusItem("b.item", { alignment: "right" }),
        ]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    // 初始外侧优先序按 id 字典序:a.item(0), b.item(10)
    // 直接定位 b.item 行的上移按钮(而非组内绝对下标),不受 core.agent-status
    // 行(独立左组)插入顺序影响。
    const bRow = screen.getByTestId("status-bar-row-b.item");
    fireEvent.click(
      within(bRow).getByRole("button", { name: "Move up (outward)" })
    );

    await waitFor(() => {
      // F8:moveWithinGroup 改走批量命令 applyOverrides,一次 IPC 携带全部
      // 有变化的 order patch,而不是 N 次顺序 setItemOverride(原子性 + 单次广播)。
      expect(
        window.pier.terminalStatusBarPrefs.applyOverrides
      ).toHaveBeenCalledWith({ "a.item": { order: 10 } });
    });
    expect(
      window.pier.terminalStatusBarPrefs.setItemOverride
    ).not.toHaveBeenCalled();
    expect(
      window.pier.terminalStatusBarPrefs.applyOverrides
    ).toHaveBeenCalledTimes(1);
  });

  it("F9:批量重排 IPC 失败时 showAppAlert 报错(不吞错误)", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          applyOverrides: vi.fn(() => Promise.reject(new Error("boom"))),
          getAll: vi.fn(async () => emptyPrefs()),
          onChanged: vi.fn(() => () => undefined),
          resetItem: vi.fn(async () => emptyPrefs()),
          setItemOverride: vi.fn(async () => emptyPrefs()),
        },
      },
    });
    usePluginRegistryStore.setState({
      initialized: true,
      // 同上一个 F8 case:插件项放到右组以隔离 core.agent-status(恒在左组)。
      plugins: [
        entry("pier.git", true, [
          statusItem("a.item", { alignment: "right" }),
          statusItem("b.item", { alignment: "right" }),
        ]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    const bRow = screen.getByTestId("status-bar-row-b.item");
    fireEvent.click(
      within(bRow).getByRole("button", { name: "Move up (outward)" })
    );

    await waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "boom",
        title: "Failed to update status bar item",
      });
    });
  });

  it("F9:显示开关 IPC 失败时 showAppAlert 报错(不吞错误)", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          applyOverrides: vi.fn(async () => emptyPrefs()),
          getAll: vi.fn(async () => emptyPrefs()),
          onChanged: vi.fn(() => () => undefined),
          resetItem: vi.fn(async () => emptyPrefs()),
          setItemOverride: vi.fn(() =>
            Promise.reject(new Error("switch boom"))
          ),
        },
      },
    });
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true, [statusItem("pier.worktree.status")])],
    });
    render(<TerminalStatusBarBlock />);

    const pluginRow = screen.getByTestId("status-bar-row-pier.worktree.status");
    fireEvent.click(within(pluginRow).getByRole("switch", { name: "Visible" }));

    await waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "switch boom",
        title: "Failed to update status bar item",
      });
    });
  });

  it("core 声明源的项出现在设置页管理块(即使无任何插件启用)", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [],
    });
    useTerminalStatusBarPrefsStore.setState({
      error: null,
      initialized: true,
      prefs: { items: {}, version: 1 },
    });

    render(<TerminalStatusBarBlock />);

    // Core 声明表恒有 core.agent-status,应出现一行
    expect(
      screen.getByTestId("status-bar-row-core.agent-status")
    ).toBeInTheDocument();
  });

  it("组首项上移按钮禁用,组尾项下移按钮禁用(M2: aria-disabled)", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      // core.agent-status 恒声明在左组,插件项放到右组以隔离出干净的两项组,
      // 保持「组首/组尾」断言精确指向 a.item/b.item 而非被 core 行稀释。
      plugins: [
        entry("pier.git", true, [
          statusItem("a.item", { alignment: "right" }),
          statusItem("b.item", { alignment: "right" }),
        ]),
      ],
    });
    render(<TerminalStatusBarBlock />);
    // 直接按行(而非组内绝对下标)定位 a.item/b.item 的上下移按钮,不受
    // core.agent-status 行(独立左组,自身也有一对上下移按钮)混入影响。
    const aRow = screen.getByTestId("status-bar-row-a.item");
    const bRow = screen.getByTestId("status-bar-row-b.item");
    const aUp = within(aRow).getByRole("button", { name: "Move up (outward)" });
    const aDown = within(aRow).getByRole("button", {
      name: "Move down (inward)",
    });
    const bUp = within(bRow).getByRole("button", { name: "Move up (outward)" });
    const bDown = within(bRow).getByRole("button", {
      name: "Move down (inward)",
    });
    expect(aUp).toHaveAttribute("aria-disabled", "true");
    expect(bDown).toHaveAttribute("aria-disabled", "true");
    expect(aDown).toHaveAttribute("aria-disabled", "false");
    expect(bUp).toHaveAttribute("aria-disabled", "false");
    expect(aUp).not.toBeDisabled();
    expect(bDown).not.toBeDisabled();
  });
});
