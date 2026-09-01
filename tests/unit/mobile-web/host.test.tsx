/**
 * H2 工作台：可投影面板分组、waiting 置顶、去掉全局变更/文件入口。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";
import { HostPage } from "../../../apps/mobile-web/src/pages/host.tsx";

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
    revision: 3,
    runtimes: [],
    tasks: [],
    windows: [],
    worktrees: [],
    ...partial,
  };
}

describe("HostPage（H2 可投影面板列表）", () => {
  beforeEach(() => {
    commandMock.mockReset();
    commandMock.mockResolvedValue({ gitRootPath: "/wt-b", panelId: "p-git" });
    window.location.hash = "#/host";
    useMobileWebStore.setState({
      snapshot: snapshot({
        agents: [
          {
            agentId: "codex",
            panelId: "p-ready",
            windowId: "w1",
            cwd: "/repo",
          },
          {
            agentId: "claude",
            panelId: "p-wait",
            windowId: "w1",
            cwd: "/repo",
          },
        ],
        activity: [
          {
            kind: "agent",
            panelId: "p-ready",
            status: "ready",
            windowId: "w1",
          },
          {
            kind: "agent",
            panelId: "p-wait",
            pendingInteractionId: "ix",
            status: "waiting",
            windowId: "w1",
          },
        ],
        panels: [
          {
            panelId: "p-ready",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo",
          },
          {
            panelId: "p-wait",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo",
          },
          {
            panelId: "p-shell",
            windowId: "w1",
            component: "terminal",
            cwd: "/repo/apps",
            title: "zsh",
          },
          {
            panelId: "p-git",
            windowId: "w1",
            component: "pier.git.changes",
            cwd: "/wt-b",
            gitRoot: "/wt-b",
          },
          {
            panelId: "p-doc",
            windowId: "w1",
            component: "pier.files.filePanel",
            cwd: "/repo",
            sourcePath: "src/notes.md",
            sourceRoot: "/repo",
            title: "notes.md",
          },
        ],
      }),
      revision: 3,
    });
  });

  afterEach(() => {
    cleanup();
    useMobileWebStore.setState({ snapshot: null, revision: 0 });
    window.location.hash = "";
  });

  it("分组列出终端/变更/文档，waiting 置顶，无全局变更/文件入口", () => {
    render(<HostPage />);
    const terminals = screen.getByTestId("host-group-terminals");
    const terminalButtons = terminals.querySelectorAll("button");
    expect(terminalButtons[0]?.getAttribute("data-testid")).toBe(
      "panel-p-wait"
    );
    expect(screen.getByTestId("panel-p-shell").textContent).toContain("zsh");
    expect(screen.getByTestId("host-group-changes").textContent).toContain(
      "变更 · wt-b"
    );
    expect(screen.getByTestId("host-group-docs").textContent).toContain(
      "notes.md"
    );
    expect(screen.queryByTestId("host-nav-changes")).toBeNull();
    expect(screen.queryByTestId("host-nav-files")).toBeNull();
    expect(screen.getByTestId("host-nav-notifications")).toBeDefined();
  });

  it("状态过滤只作用于终端组", () => {
    render(<HostPage />);
    fireEvent.click(
      within(screen.getByTestId("host-filters")).getByText(/需要你处理/)
    );
    expect(screen.queryByTestId("panel-p-ready")).toBeNull();
    expect(screen.getByTestId("panel-p-wait")).toBeDefined();
    expect(screen.getByTestId("host-group-changes")).toBeDefined();
  });

  it("点变更行携带 gitRoot 并同步聚焦桌面面板；点终端行进会话", () => {
    render(<HostPage />);
    fireEvent.click(screen.getByTestId("panel-p-git"));
    expect(commandMock).toHaveBeenCalledWith({
      cwd: "/wt-b",
      type: "git.openReviewPanel",
    });
    expect(window.location.hash).toContain("/changes?cwd=");
    expect(decodeURIComponent(window.location.hash)).toContain("/wt-b");
    fireEvent.click(screen.getByTestId("panel-p-shell"));
    expect(window.location.hash).toBe("#/session?panel=p-shell");
  });

  it("点文档行用 sourcePath 而不是 tab 标题", () => {
    render(<HostPage />);
    fireEvent.click(screen.getByTestId("panel-p-doc"));
    expect(decodeURIComponent(window.location.hash)).toBe(
      "#/files?root=/repo&path=src/notes.md"
    );
  });
});
