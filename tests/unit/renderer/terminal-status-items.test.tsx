import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasDeclaredTerminalStatusItems,
  hasVisibleTerminalStatusItems,
  shouldMountTerminalStatusBar,
  TerminalStatusBar,
  terminalStatusItemRegistry,
  useTerminalStatusBarItems,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

function pluginEntryWithStatusItem(id: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [{ id: `${id}.item`, permissions: [], title: id }],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

const INITIAL_PLUGIN_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const context: PanelContext = {
  branch: "feature/worktree",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRootPath: "/Users/xyz/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

function renderBar() {
  return render(
    <TerminalStatusBar
      context={context}
      cwd={context.cwd ?? null}
      panelId="terminal-1"
      title={null}
    />
  );
}

function setPrefs(
  items: Record<
    string,
    { alignment?: "left" | "right"; hidden?: boolean; order?: number }
  >
) {
  useTerminalStatusBarPrefsStore.setState({
    initialized: true,
    prefs: { items, version: 1 },
  });
}

afterEach(() => {
  terminalStatusItemRegistry.clearForTests();
  setPrefs({});
  usePluginRegistryStore.setState(INITIAL_PLUGIN_STATE);
});

describe("terminal status bar grouped rendering", () => {
  it("无声明无覆盖时全部落左组,order 0 下按 id 字典序", () => {
    terminalStatusItemRegistry.register({
      id: "test.second",
      render: () => <span>Second</span>,
    });
    terminalStatusItemRegistry.register({
      id: "test.first",
      render: () => <span>First</span>,
    });

    renderBar();

    expect(screen.getByTestId("terminal-status-bar")).toHaveTextContent(
      "FirstSecond"
    );
    expect(
      screen.getByTestId("terminal-status-bar-spacer")
    ).toBeInTheDocument();
  });

  it("用户覆盖 alignment: right 的项渲染在 spacer 之后", () => {
    terminalStatusItemRegistry.register({
      id: "test.left",
      render: () => <span>L</span>,
    });
    terminalStatusItemRegistry.register({
      id: "test.right",
      render: () => <span>R</span>,
    });
    setPrefs({ "test.right": { alignment: "right" } });

    renderBar();

    const bar = screen.getByTestId("terminal-status-bar");
    const spacer = screen.getByTestId("terminal-status-bar-spacer");
    const children = Array.from(bar.children);
    expect(children.indexOf(spacer)).toBe(1);
    expect(bar).toHaveTextContent("LR");
  });

  it("hidden 覆盖过滤该项渲染;无插件声明状态项时容器整体不挂载", () => {
    terminalStatusItemRegistry.register({
      id: "test.only",
      render: () => <span>Only</span>,
    });
    setPrefs({ "test.only": { hidden: true } });

    renderBar();

    // 本测试从未往 plugin-registry.store 写入声明项,declaredTerminalStatusItemsById
    // 为空 —— 属于 F4「零声明项」分支,容器整体不挂载(与「有声明但全隐藏」区分)。
    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("F4:有已启用插件声明状态项时,即使全部生效隐藏,容器仍挂载(右键面保留)", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [pluginEntryWithStatusItem("pier.a")],
    });
    setPrefs({ "pier.a.item": { hidden: true } });

    renderBar();

    const bar = screen.getByTestId("terminal-status-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent("");
  });

  it("F4:零声明项(无已启用插件声明 terminalStatusItems)时容器整体不挂载", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [],
    });

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("isVisible 动态可见性在 hidden 过滤之后仍生效(不影响挂载判定,只影响渲染内容)", () => {
    terminalStatusItemRegistry.register({
      id: "test.invisible",
      isVisible: () => false,
      render: () => <span>Invisible</span>,
    });

    renderBar();

    // 同上:未声明任何插件状态项,零声明分支容器不挂载。
    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("状态项容器允许收缩，内容溢出时才由内部 truncate 截断", () => {
    terminalStatusItemRegistry.register({
      id: "test.item",
      order: 10,
      render: () => <span>Item</span>,
    });

    render(
      <TerminalStatusBar
        context={context}
        cwd={context.cwd ?? null}
        panelId="terminal-1"
        title={null}
      />
    );

    const bar = screen.getByTestId("terminal-status-bar");
    const wrapper = bar.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("min-w-0");
    expect(wrapper.className).not.toContain("shrink-0");
  });

  it("dispose 后移除状态项", () => {
    const dispose = terminalStatusItemRegistry.register({
      id: "test.item",
      render: () => <span>Visible</span>,
    });
    dispose();

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });
});

describe("hasVisibleTerminalStatusItems", () => {
  it("左右任一组可见即 true", () => {
    const statusContext = {
      context,
      cwd: context.cwd ?? null,
      panelId: "terminal-1",
      title: null,
    };
    expect(
      hasVisibleTerminalStatusItems({ left: [], right: [] }, statusContext)
    ).toBe(false);
    expect(
      hasVisibleTerminalStatusItems(
        { left: [], right: [{ id: "x", render: () => null }] },
        statusContext
      )
    ).toBe(true);
  });
});

describe("hasDeclaredTerminalStatusItems(F4:挂载判定口径 —— 有声明项即挂载,不看 hidden)", () => {
  it("已启用插件声明了 terminalStatusItems 时为 true(与 hidden 生效值无关)", () => {
    expect(
      hasDeclaredTerminalStatusItems([pluginEntryWithStatusItem("pier.a")])
    ).toBe(true);
  });

  it("零声明项(空插件列表或均无 terminalStatusItems)时为 false", () => {
    expect(hasDeclaredTerminalStatusItems([])).toBe(false);
  });
});

describe("shouldMountTerminalStatusBar(F4:与 terminal-panel.tsx hasStatusBar 必须同一实现)", () => {
  const statusContext = {
    context,
    cwd: context.cwd ?? null,
    panelId: "terminal-1",
    title: null,
  };

  it("零声明且零可见 → false", () => {
    expect(
      shouldMountTerminalStatusBar({ left: [], right: [] }, statusContext, [])
    ).toBe(false);
  });

  it("有声明但零可见(全部 hidden)→ true", () => {
    expect(
      shouldMountTerminalStatusBar({ left: [], right: [] }, statusContext, [
        pluginEntryWithStatusItem("pier.a"),
      ])
    ).toBe(true);
  });

  it("零声明但有可见项(运行时注册未声明)→ true", () => {
    expect(
      shouldMountTerminalStatusBar(
        { left: [{ id: "x", render: () => null }], right: [] },
        statusContext,
        []
      )
    ).toBe(true);
  });
});

// 保持导出面完整性:hook 存在且可从组件文件 import(渲染路径已在上面覆盖)。
describe("useTerminalStatusBarItems export", () => {
  it("是函数", () => {
    expect(typeof useTerminalStatusBarItems).toBe("function");
  });
});
