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

  it("hidden 覆盖过滤该项渲染;core 声明恒存在使容器恒挂载(内容为空但入口保留)", () => {
    terminalStatusItemRegistry.register({
      id: "test.only",
      render: () => <span>Only</span>,
    });
    setPrefs({ "test.only": { hidden: true } });

    renderBar();

    // core 声明表恒含 core.agent-status → hasDeclaredTerminalStatusItems=true → 容器挂载。
    // test.only 因 hidden 被过滤;本测试未走 registerAgentStatusItem 故 agent-status 也不渲染。
    const bar = screen.getByTestId("terminal-status-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent("");
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

  it("F4:仅 core 声明时容器仍挂载(agent activity 无关)", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [],
    });

    renderBar();

    // 无插件声明,但 core 声明恒含 core.agent-status → 容器挂载。
    const bar = screen.getByTestId("terminal-status-bar");
    expect(bar).toBeInTheDocument();
  });

  it("isVisible 动态可见性在 hidden 过滤之后仍生效(容器因 core 声明挂载,test.invisible 因 isVisible=false 不渲染)", () => {
    terminalStatusItemRegistry.register({
      id: "test.invisible",
      isVisible: () => false,
      render: () => <span>Invisible</span>,
    });

    renderBar();

    // core 声明恒存在,容器挂载;test.invisible 被 isVisible 过滤,不出现在 DOM。
    const bar = screen.getByTestId("terminal-status-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).not.toHaveTextContent("Invisible");
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

  it("dispose 后移除状态项渲染;core 声明恒存在使容器仍挂载", () => {
    const dispose = terminalStatusItemRegistry.register({
      id: "test.item",
      render: () => <span>Visible</span>,
    });
    dispose();

    renderBar();

    // dispose 让 test.item 从 registry 移除;core 声明恒存在 → 容器挂载但不含 test.item。
    const bar = screen.getByTestId("terminal-status-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).not.toHaveTextContent("Visible");
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

  it("空插件列表下仍为 true(core 声明恒存在于合并层)", () => {
    // 引入 CORE_TERMINAL_STATUS_ITEMS 后 hasDeclaredTerminalStatusItems 的口径已变:
    // 即使插件列表为空,合并层永远至少含 core.agent-status → 恒返回 true。
    // F4 "零声明不挂载"分支自此对纯 plugin 侧不再触发(spec §5)。
    expect(hasDeclaredTerminalStatusItems([])).toBe(true);
  });
});

describe("shouldMountTerminalStatusBar(F4:与 terminal-panel.tsx hasStatusBar 必须同一实现)", () => {
  const statusContext = {
    context,
    cwd: context.cwd ?? null,
    panelId: "terminal-1",
    title: null,
  };

  it("零 plugin 声明零可见但 core 声明恒存在 → true", () => {
    // 同上:hasDeclaredTerminalStatusItems 恒 true(因 core 声明) → shouldMount 恒 true。
    expect(
      shouldMountTerminalStatusBar({ left: [], right: [] }, statusContext, [])
    ).toBe(true);
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
