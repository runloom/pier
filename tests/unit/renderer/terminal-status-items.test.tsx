import type { PanelContext } from "@shared/contracts/panel.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasVisibleTerminalStatusItems,
  TerminalStatusBar,
  terminalStatusItemRegistry,
  useTerminalStatusBarItems,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

const context: PanelContext = {
  branch: "feature/worktree",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
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

  it("hidden 覆盖过滤该项;全部隐藏时状态栏不渲染", () => {
    terminalStatusItemRegistry.register({
      id: "test.only",
      render: () => <span>Only</span>,
    });
    setPrefs({ "test.only": { hidden: true } });

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("isVisible 动态可见性在 hidden 过滤之后仍生效", () => {
    terminalStatusItemRegistry.register({
      id: "test.invisible",
      isVisible: () => false,
      render: () => <span>Invisible</span>,
    });

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
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

// 保持导出面完整性:hook 存在且可从组件文件 import(渲染路径已在上面覆盖)。
describe("useTerminalStatusBarItems export", () => {
  it("是函数", () => {
    expect(typeof useTerminalStatusBarItems).toBe("function");
  });
});
