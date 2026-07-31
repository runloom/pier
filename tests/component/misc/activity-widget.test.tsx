import { fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ActivityWidget } from "@/panel-kits/workbench/core-widgets/activity/widget.tsx";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const activateMock = vi.fn();
const toastError = vi.fn();
const promptRename = vi.fn((_args: unknown) => Promise.resolve(true));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/workspace/panel-activation.ts", () => ({
  activateWorkspacePanel: (...args: unknown[]) => activateMock(...args),
}));

vi.mock("@/lib/agent-runtime/open-agent-index-quickpick.tsx", () => ({
  openAgentIndexQuickPick: vi.fn(async () => undefined),
}));

vi.mock("@/lib/agent-runtime/current-window-id.ts", () => ({
  currentElectronWindowId: () => "win-local",
}));

vi.mock("@/lib/agent-runtime/rename-agent-session.ts", () => ({
  canRenameAgentSession: () => true,
  promptRenameAgentSession: (args: unknown) => promptRename(args),
}));

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  toastError.mockReset();
  promptRename.mockClear();
  activateMock.mockReset();
  activateMock.mockReturnValue({ ok: true });
  useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  useTaskRunsStore.setState({
    snapshot: { runs: {}, version: 0 },
  });
  useAgentRuntimeIndexStore.getState().reset();
  useWorkspaceStore.setState({
    api: {
      panels: [
        {
          api: { setActive: vi.fn() },
          id: "panel-wait",
          view: { contentComponent: "terminal" },
        },
        {
          api: { setActive: vi.fn() },
          id: "panel-run",
          view: { contentComponent: "terminal" },
        },
      ],
    } as never,
  });
});

function widgetProps(size = { h: 4, w: 6 }) {
  return {
    instanceId: "core.activity-overview",
    params: {},
    refreshToken: 0,
    size,
    updateParams: vi.fn(),
    visible: true,
  };
}

describe("ActivityWidget", () => {
  it("shows empty state when there is no activity on medium cards", () => {
    render(<ActivityWidget {...widgetProps()} />);
    expect(
      screen.getByText(i18next.t("workbench.widget.activityOverview.empty"))
    ).toBeInTheDocument();
    expect(screen.getByTestId("activity-stat-grid")).toBeInTheDocument();
  });

  it("shows only full-width KPI tiles on compact cards (no list or empty body)", () => {
    useForegroundActivityStore.setState({
      ts: 9,
      activities: {
        "panel-wait": {
          agentId: "codex",
          kind: "agent",
          panelId: "panel-wait",
          sessionTitle: "Review PR",
          sessionTitleSource: "user",
          source: "hook",
          spawnedAt: 1,
          status: "waiting",
          subagentCount: 0,
          updatedAt: 10,
          windowId: "win-local",
        },
      },
    });

    render(<ActivityWidget {...widgetProps({ h: 2, w: 4 })} />);
    const root = screen.getByTestId("activity-summary-only");
    expect(root).toBeInTheDocument();
    expect(root.className).not.toMatch(/justify-center/);
    expect(screen.getByTestId("activity-stat-grid")).toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-row-panel-wait")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18next.t("workbench.widget.activityOverview.empty"))
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Review PR")).not.toBeInTheDocument();
  });

  it("keeps empty body on medium cards even when narrow", () => {
    render(<ActivityWidget {...widgetProps({ h: 3, w: 3 })} />);
    expect(
      screen.getByText(i18next.t("workbench.widget.activityOverview.empty"))
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-summary-only")
    ).not.toBeInTheDocument();
  });

  it("does not list other-window task runs under this window", () => {
    useTaskRunsStore.setState({
      snapshot: {
        runs: {
          "run-other": {
            mode: "background",
            nodes: {
              test: {
                label: "remote-test",
                panelId: "bg-other",
                status: "running",
                taskId: "package-script:test",
              },
            },
            originPanelId: "terminal-other",
            ownerWindowId: "win-other",
            projectRootPath: "/repo",
            rootTaskId: "package-script:test",
            runId: "run-other",
            startedAt: 1,
            status: "running",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });

    render(<ActivityWidget {...widgetProps()} />);
    expect(screen.queryByText("remote-test")).not.toBeInTheDocument();
    expect(
      screen.getByText(i18next.t("workbench.widget.activityOverview.empty"))
    ).toBeInTheDocument();
  });

  it("orders needsYou rows above running and reveals panel on click", () => {
    useForegroundActivityStore.setState({
      ts: 1,
      activities: {
        "panel-run": {
          agentId: "claude",
          kind: "agent",
          panelId: "panel-run",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 100,
          windowId: "win-local",
        },
        "panel-wait": {
          agentId: "codex",
          kind: "agent",
          panelId: "panel-wait",
          sessionTitle: "Review PR",
          sessionTitleSource: "user",
          source: "hook",
          spawnedAt: 1,
          stateStartedAt: 50,
          status: "waiting",
          subagentCount: 0,
          updatedAt: 10,
          windowId: "win-local",
        },
      },
    });

    render(<ActivityWidget {...widgetProps()} />);

    const waitRow = screen.getByTestId("activity-row-panel-wait");
    const runRow = screen.getByTestId("activity-row-panel-run");
    expect(waitRow.compareDocumentPosition(runRow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText("Review PR")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        i18next.t("workbench.widget.activityOverview.section.needsYou")
      ).length
    ).toBeGreaterThan(0);

    fireEvent.click(waitRow);
    expect(activateMock).toHaveBeenCalledWith(
      expect.anything(),
      "panel-wait",
      expect.objectContaining({ reveal: "always" })
    );
  });

  it("toasts when the target panel is gone", () => {
    activateMock.mockReturnValue({
      code: "not_found",
      message: "gone",
      ok: false,
    });
    useForegroundActivityStore.setState({
      ts: 2,
      activities: {
        missing: {
          agentId: "claude",
          kind: "agent",
          panelId: "missing",
          source: "hook",
          spawnedAt: 1,
          status: "error",
          subagentCount: 0,
          updatedAt: 1,
          windowId: "win-local",
        },
      },
    });

    render(<ActivityWidget {...widgetProps()} />);
    fireEvent.click(screen.getByTestId("activity-row-missing"));
    expect(toastError).toHaveBeenCalledWith(
      i18next.t("workbench.widget.activityOverview.panelGone")
    );
  });

  it("exposes agent identity (which agent, subagent role) in the accessible name", () => {
    // 标题只是可读性信号；「在调哪个 agent 会话」必须能从无障碍名字读出来，
    // 否则同名/无名会话在读屏与列表里无法区分。
    useForegroundActivityStore.setState({
      ts: 4,
      activities: {
        "panel-run": {
          actorHint: "subagent",
          agentId: "claude",
          kind: "agent",
          panelId: "panel-run",
          parentSessionId: "sess-parent",
          sessionId: "sess-child",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 100,
          windowId: "win-local",
        },
      },
    });

    render(<ActivityWidget {...widgetProps()} />);

    const label =
      screen.getByTestId("activity-row-panel-run").getAttribute("aria-label") ??
      "";
    expect(label).toContain("Claude");
    expect(label).toContain(
      i18next.t("workbench.widget.activityOverview.identity.subagent")
    );
  });

  it("offers inline rename on agent rows only, seeded with the undisambiguated title", () => {
    // 用户改名是唯一永远可信的标题来源，必须在活动总览里直接够得着；
    // 初值用未消歧的原始标题——同屏序号只是歧义提示，不该写进用户标题。
    useForegroundActivityStore.setState({
      ts: 5,
      activities: {
        "panel-run": {
          agentId: "claude",
          kind: "agent",
          panelId: "panel-run",
          sessionTitle: "Review PR",
          sessionTitleSource: "provider",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 100,
          windowId: "win-local",
        },
        "panel-wait": {
          commandLine: "pnpm dev",
          kind: "shell",
          panelId: "panel-wait",
          spawnedAt: 1,
          updatedAt: 2,
          windowId: "win-local",
        },
      },
    });

    render(<ActivityWidget {...widgetProps({ h: 5, w: 6 })} />);

    expect(
      screen.queryByTestId("activity-row-rename-panel-wait")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("activity-row-rename-panel-run"));
    expect(promptRename).toHaveBeenCalledWith({
      initialTitle: "Review PR",
      panelId: "panel-run",
    });
    // 改名钮不能顺带触发整行的「聚焦面板」。
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("shows other-window footer when Index has remote agents", () => {
    useForegroundActivityStore.setState({
      ts: 3,
      activities: {
        local: {
          agentId: "claude",
          kind: "agent",
          panelId: "local",
          source: "hook",
          spawnedAt: 1,
          status: "ready",
          subagentCount: 0,
          updatedAt: 1,
          windowId: "win-local",
        },
      },
    });
    useAgentRuntimeIndexStore.getState().applySnapshot({
      ts: 1,
      entries: [
        {
          agentId: "claude",
          agentRef: "win-other\0remote",
          panelId: "remote",
          source: "hook",
          status: "waiting",
          updatedAt: 1,
          windowId: "win-other",
        },
      ],
    });

    render(<ActivityWidget {...widgetProps({ h: 5, w: 6 })} />);
    expect(screen.getByTestId("activity-index-footer")).toBeInTheDocument();
  });
});
