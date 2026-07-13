import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForegroundActivityBridge } from "@/components/common/foreground-activity-bridge.tsx";
import { initI18n } from "@/i18n/index.ts";
import {
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TERMINAL_STATUS_ITEMS,
} from "@/panel-kits/terminal/core-terminal-status-items.ts";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";

function installForegroundActivityApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      foregroundActivity: {
        onChanged: vi.fn(() => () => undefined),
        snapshot: vi.fn(async () => ({ activities: [], ts: 1 })),
      },
    },
  });
}

beforeEach(async () => {
  await initI18n();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  terminalStatusItemRegistry.clearForTests();
  useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  useLocalEnvironmentsStore.setState({
    projects: [],
    version: 1,
    worktreeBindings: [],
  });
});

describe("core terminal status items declarations", () => {
  it("keeps agent status but removes task status from the bottom bar", () => {
    const ids = CORE_TERMINAL_STATUS_ITEMS.map((item) => item.id);

    expect(ids).toEqual([CORE_AGENT_STATUS_ITEM_ID]);
    expect(ids).not.toContain("core.task-status");
    expect(ids).not.toContain("core.environment-status");
  });
});

describe("ForegroundActivityBridge terminal status registration", () => {
  it("registers only agent status", async () => {
    installForegroundActivityApi();

    render(<ForegroundActivityBridge />);

    await waitFor(() => {
      expect(terminalStatusItemRegistry.list().map((item) => item.id)).toEqual([
        CORE_AGENT_STATUS_ITEM_ID,
      ]);
    });
    expect(
      terminalStatusItemRegistry.list().map((item) => item.id)
    ).not.toContain("core.task-status");
  });

  it("does not mount environment selection in a project terminal status bar", async () => {
    installForegroundActivityApi();
    useLocalEnvironmentsStore.setState({
      projects: [
        {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          projectRootPath: "/repo",
          setupCommand: "",
          updatedAt: 2,
        },
      ],
      version: 1,
      worktreeBindings: [],
    });

    render(
      <>
        <ForegroundActivityBridge />
        <TerminalStatusBar
          context={{
            contextId: "ctx-1",
            projectRootPath: "/repo",
            updatedAt: 1,
          }}
          cwd="/repo"
          panelId="terminal-1"
          title={null}
        />
      </>
    );

    await waitFor(() => {
      expect(
        terminalStatusItemRegistry.list().map((item) => item.id)
      ).toContain(CORE_AGENT_STATUS_ITEM_ID);
    });
    expect(screen.queryByTestId("environment-status")).toBeNull();
    expect(screen.queryByTestId("task-status-item")).toBeNull();
    expect(screen.queryByText("Pier")).toBeNull();
  });

  it("先订阅 push 再请求 snapshot，并拒绝迟到的旧 snapshot 回退状态", async () => {
    let onChanged:
      | ((broadcast: { activities: []; ts: number }) => void)
      | undefined;
    let resolveSnapshot:
      | ((broadcast: { activities: []; ts: number }) => void)
      | undefined;
    const onChangedMock = vi.fn(
      (listener: (broadcast: { activities: []; ts: number }) => void) => {
        onChanged = listener;
        return () => undefined;
      }
    );
    const snapshotMock = vi.fn(
      () =>
        new Promise<{ activities: []; ts: number }>((resolve) => {
          resolveSnapshot = resolve;
        })
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        foregroundActivity: {
          onChanged: onChangedMock,
          snapshot: snapshotMock,
        },
      },
    });

    render(<ForegroundActivityBridge />);

    expect(onChangedMock.mock.invocationCallOrder[0]).toBeLessThan(
      snapshotMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    onChanged?.({ activities: [], ts: 2 });
    resolveSnapshot?.({ activities: [], ts: 1 });
    await waitFor(() => {
      expect(useForegroundActivityStore.getState().ts).toBe(2);
    });
  });

  it("卸载后忽略迟到的 snapshot Promise", async () => {
    let resolveSnapshot:
      | ((broadcast: { activities: []; ts: number }) => void)
      | undefined;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        foregroundActivity: {
          onChanged: vi.fn(() => () => undefined),
          snapshot: vi.fn(
            () =>
              new Promise<{ activities: []; ts: number }>((resolve) => {
                resolveSnapshot = resolve;
              })
          ),
        },
      },
    });
    const view = render(<ForegroundActivityBridge />);

    view.unmount();
    resolveSnapshot?.({ activities: [], ts: 10 });
    await Promise.resolve();

    expect(useForegroundActivityStore.getState().ts).toBe(0);
  });

  it("store 拒绝相等 ts，并接受更大 ts 的空快照清理", () => {
    useForegroundActivityStore.getState().apply({
      activities: [
        {
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-1",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 1,
          windowId: "1",
        },
      ],
      ts: 5,
    });
    useForegroundActivityStore.getState().apply({ activities: [], ts: 5 });
    expect(useForegroundActivityStore.getState().activities).toHaveProperty(
      "terminal-1"
    );

    useForegroundActivityStore.getState().apply({ activities: [], ts: 6 });
    expect(useForegroundActivityStore.getState().activities).toEqual({});
  });

  it("内部未确认状态只显示 agent 图标，不显示容易误解的状态文字", async () => {
    installForegroundActivityApi();
    useForegroundActivityStore.setState({
      activities: {
        "terminal-1": {
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-1",
          source: "hook",
          spawnedAt: 1,
          subagentCount: 0,
          updatedAt: 2,
          windowId: "1",
        },
      },
      ts: 2,
    });

    render(
      <>
        <ForegroundActivityBridge />
        <TerminalStatusBar
          context={undefined}
          cwd="/repo"
          panelId="terminal-1"
          title={null}
        />
      </>
    );

    const item = await screen.findByTestId("agent-status-item");
    expect(item).toHaveAttribute("data-agent-status", "none");
    expect(item.querySelector("[data-activity-badge]")).toBeNull();
  });
});
