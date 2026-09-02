/**
 * S1 会话：普通终端只读读屏、无审批条；变更/文件入口携带 cwd。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";

vi.mock("../../../apps/mobile-web/src/components/terminal-screen.tsx", () => ({
  TerminalScreen: (props: { panelId: string; windowId?: string }) => (
    <pre data-testid="terminal-screen" data-window={props.windowId}>
      {props.panelId}
    </pre>
  ),
}));

const { commandMock } = vi.hoisted(() => ({ commandMock: vi.fn() }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  getMobileClient: () => ({ command: commandMock }),
  refreshSnapshot: vi.fn(),
}));

function snapshot(
  partial: Partial<ControlSnapshotPayload>
): ControlSnapshotPayload {
  return {
    activity: [],
    agents: [],
    bootId: "boot",
    capturedAt: 1,
    notifications: [],
    panels: [],
    revision: 1,
    runtimes: [],
    tasks: [],
    windows: [],
    worktrees: [],
    ...partial,
  };
}

describe("SessionPage", () => {
  beforeEach(async () => {
    commandMock.mockReset();
    commandMock.mockResolvedValue({ gitRootPath: "/repo", panelId: "rp-1" });
    window.location.hash = "#/session?panel=p-shell&window=w1";
    useMobileWebStore.setState({
      snapshot: snapshot({
        agents: [
          {
            agentId: "codex",
            cwd: "/repo/agent",
            panelId: "p-agent",
            windowId: "w1",
          },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "p-agent",
            pendingInteractionId: "ix",
            status: "waiting",
            windowId: "w1",
          },
        ],
        panels: [
          {
            panelId: "p-shell",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/apps/mobile-web",
            gitRoot: "/repo",
            title: "zsh",
          },
          {
            panelId: "p-agent",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/agent",
            gitRoot: "/repo/agent",
          },
        ],
      }),
    });
  });

  afterEach(() => {
    cleanup();
    useMobileWebStore.setState({ snapshot: null });
    window.location.hash = "";
  });

  it("变更入口作用域是 gitRoot（非 shell cwd），并同步打开桌面审查面板", async () => {
    useMobileWebStore.setState({
      snapshot: snapshot({
        panels: [
          {
            panelId: "p-shell",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/packages/ui",
            gitRoot: "/repo",
            title: "zsh",
            worktreeKey: "/repo",
          },
        ],
      }),
    });
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    fireEvent.click(screen.getByTestId("session-nav-changes"));
    expect(commandMock).toHaveBeenCalledWith({
      cwd: "/repo",
      type: "git.openReviewPanel",
    });
    expect(decodeURIComponent(window.location.hash)).toBe(
      "#/changes?cwd=/repo&fromPanel=p-shell&fromWindow=w1"
    );
  });

  it("非 git 目录的会话没有变更入口（与桌面一致），文件入口保留", async () => {
    useMobileWebStore.setState({
      snapshot: snapshot({
        panels: [
          {
            panelId: "p-shell",
            windowId: "w1",
            component: "terminal",
            cwd: "/Users/me/Downloads",
            title: "zsh",
            worktreeKey: "/Users/me/Downloads",
          },
        ],
      }),
    });
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    expect(screen.queryByTestId("session-nav-changes")).toBeNull();
    expect(screen.getByTestId("session-nav-files")).toBeDefined();
  });

  it("普通终端进入只读读屏，无审批条，入口携带 gitRoot", async () => {
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    expect(screen.getByText("zsh")).toBeDefined();
    expect(screen.getByTestId("terminal-screen").textContent).toBe("p-shell");
    expect(screen.queryByTestId("approval-bar")).toBeNull();
    fireEvent.click(screen.getByTestId("session-nav-changes"));
    expect(decodeURIComponent(window.location.hash)).toBe(
      "#/changes?cwd=/repo&fromPanel=p-shell&fromWindow=w1"
    );
  });

  it("智能体会话仍渲染审批条", async () => {
    window.location.hash = "#/session?panel=p-agent&window=w1";
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    expect(screen.getByTestId("approval-bar")).toBeDefined();
    expect(screen.getByText("agent")).toBeDefined();
    expect(screen.queryByText("codex")).toBeNull();
    fireEvent.click(screen.getByTestId("session-nav-files"));
    expect(decodeURIComponent(window.location.hash)).toBe(
      "#/files?root=/repo/agent&fromPanel=p-agent&fromWindow=w1"
    );
  });

  it("跨窗同 panelId 时按 window 绑定等待态，不误绑另一窗", async () => {
    window.location.hash = "#/session?panel=p-agent&window=w2";
    useMobileWebStore.setState({
      snapshot: snapshot({
        agents: [
          {
            agentId: "codex",
            cwd: "/repo/w1",
            panelId: "p-agent",
            windowId: "w1",
          },
          {
            agentId: "claude",
            cwd: "/repo/w2",
            panelId: "p-agent",
            windowId: "w2",
          },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "p-agent",
            pendingInteractionId: "ix-w1",
            status: "waiting",
            windowId: "w1",
          },
          {
            kind: "agent",
            panelId: "p-agent",
            pendingInteractionId: "ix-w2",
            status: "waiting",
            windowId: "w2",
          },
        ],
        panels: [
          {
            panelId: "p-agent",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/w1",
          },
          {
            panelId: "p-agent",
            windowId: "w2",
            component: "terminal",
            cwd: "/repo/w2",
          },
        ],
      }),
    });
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    expect(
      screen.getByTestId("terminal-screen").getAttribute("data-window")
    ).toBe("w2");
    expect(screen.getByTestId("approval-bar")).toBeDefined();
    fireEvent.click(screen.getByTestId("approval-key-enter"));
    expect(commandMock).toHaveBeenCalledWith({
      agentRef: "p-agent",
      interactionId: "ix-w2",
      key: "enter",
      type: "agent.attention.respond",
      windowId: "w2",
    });
    fireEvent.click(screen.getByTestId("session-nav-files"));
    expect(decodeURIComponent(window.location.hash)).toBe(
      "#/files?root=/repo/w2&fromPanel=p-agent&fromWindow=w2"
    );
  });

  it("跨窗同 panelId 且深链无 window 时 fail-closed，不打开会话", async () => {
    window.location.hash = "#/session?panel=p-agent";
    useMobileWebStore.setState({
      snapshot: snapshot({
        agents: [
          {
            agentId: "codex",
            panelId: "p-agent",
            windowId: "w1",
          },
          {
            agentId: "claude",
            panelId: "p-agent",
            windowId: "w2",
          },
        ],
        panels: [
          {
            panelId: "p-agent",
            windowId: "w1",
            component: "terminal",
          },
          {
            panelId: "p-agent",
            windowId: "w2",
            component: "terminal",
          },
        ],
      }),
    });
    const { SessionPage } = await import(
      "../../../apps/mobile-web/src/pages/session.tsx"
    );
    render(<SessionPage />);
    expect(screen.queryByTestId("terminal-screen")).toBeNull();
    expect(screen.getByText(/会话不在当前快照中/)).toBeDefined();
  });
});
