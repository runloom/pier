import type { PanelContext } from "@shared/contracts/panel.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";

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

afterEach(() => {
  terminalStatusItemRegistry.clearForTests();
});

describe("terminalStatusItemRegistry", () => {
  it("按顺序渲染注册的终端状态项", () => {
    terminalStatusItemRegistry.register({
      id: "test.second",
      order: 20,
      render: () => <span>Second</span>,
    });
    terminalStatusItemRegistry.register({
      id: "test.first",
      order: 10,
      render: () => <span>First</span>,
    });

    render(
      <TerminalStatusBar
        context={context}
        cwd={context.cwd ?? null}
        panelId="terminal-1"
        title={null}
      />
    );

    expect(screen.getByTestId("terminal-status-bar")).toHaveTextContent(
      "FirstSecond"
    );
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
      order: 10,
      render: () => <span>Visible</span>,
    });
    dispose();

    render(
      <TerminalStatusBar
        context={context}
        cwd={context.cwd ?? null}
        panelId="terminal-1"
        title={null}
      />
    );

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("按 panel context 过滤不可见状态项", () => {
    terminalStatusItemRegistry.register({
      id: "test.hidden",
      isVisible: ({ context: panelContext }) =>
        Boolean(panelContext?.worktreeRoot),
      order: 10,
      render: () => <span>Hidden</span>,
    });

    render(
      <TerminalStatusBar
        context={undefined}
        cwd="/Users/xyz"
        panelId="terminal-plain"
        title={null}
      />
    );

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });
});
