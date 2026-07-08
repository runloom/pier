import type {
  TaskListResult,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForegroundActivityBridge } from "@/components/common/foreground-activity-bridge.tsx";
import { initI18n } from "@/i18n/index.ts";
import {
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TASK_STATUS_ITEM_ID,
  CORE_TERMINAL_STATUS_ITEMS,
} from "@/panel-kits/terminal/core-terminal-status-items.ts";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import { useTaskBackgroundStore } from "@/stores/task-background.store.ts";
import {
  rememberTerminalTaskRun,
  useTerminalTaskHistoryStore,
} from "@/stores/terminal-task-history.store.ts";

function installForegroundActivityApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      foregroundActivity: {
        onChanged: vi.fn(() => () => undefined),
        snapshot: vi.fn(async () => ({ activities: [], ts: 1 })),
      },
      tasks: {
        list: vi.fn(async () => taskList()),
        spawn: vi.fn(
          async (): Promise<TaskSpawnResult> => ({
            panelIds: [],
            status: "started",
          })
        ),
      },
    },
  });
}

function taskList(projectRootPath = "/repo"): TaskListResult {
  return {
    errors: [],
    projectRootPath,
    tasks: [
      {
        commandSpec: { command: "pnpm run test", kind: "shell" },
        concurrencyPolicy: "dedupe",
        cwd: projectRootPath,
        description: "vitest",
        id: "package-script:test",
        label: "test",
        source: "package-script",
      },
      {
        commandSpec: { command: "pnpm run bootstrap", kind: "shell" },
        concurrencyPolicy: "dedupe",
        cwd: projectRootPath,
        id: "package-script:bootstrap",
        label: "bootstrap",
        source: "package-script",
      },
    ],
  };
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
  useTaskBackgroundStore.setState({
    error: null,
    initialized: false,
    snapshot: { runs: {}, version: 0 },
  });
  useTerminalTaskHistoryStore.setState({
    panels: {},
    version: 0,
  });
});

describe("core terminal status items declarations", () => {
  it("declares agent and task status, without an environment status core item", () => {
    const ids = CORE_TERMINAL_STATUS_ITEMS.map((item) => item.id);

    expect(ids).toEqual([CORE_AGENT_STATUS_ITEM_ID, CORE_TASK_STATUS_ITEM_ID]);
    expect(ids).not.toContain("core.environment-status");
  });
});

describe("ForegroundActivityBridge terminal status registration", () => {
  it("registers agent and task status", async () => {
    installForegroundActivityApi();

    render(<ForegroundActivityBridge />);

    await waitFor(() => {
      expect(
        terminalStatusItemRegistry.list().map((item) => item.id)
      ).toContain(CORE_AGENT_STATUS_ITEM_ID);
    });
    const ids = terminalStatusItemRegistry.list().map((item) => item.id);
    expect(ids).toContain(CORE_TASK_STATUS_ITEM_ID);
    expect(ids).not.toContain("core.environment-status");
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
    expect(screen.queryByText("Pier")).toBeNull();
  });

  it("hides task status in a new terminal even when the project has running background tasks", async () => {
    installForegroundActivityApi();
    useTaskBackgroundStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "/repo": {
            "package-script:test": {
              label: "test",
              projectRootPath: "/repo",
              runId: "run-1",
              startedAt: 1,
              status: "running",
              taskId: "package-script:test",
              updatedAt: 1,
            },
          },
        },
        version: 1,
      },
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
      ).toContain(CORE_TASK_STATUS_ITEM_ID);
    });
    expect(screen.queryByTestId("task-status-item")).toBeNull();
  });

  it("opens a task dropdown for only tasks run in the current terminal lifecycle", async () => {
    installForegroundActivityApi();
    rememberTerminalTaskRun({
      detail: "pnpm run test",
      label: "test",
      panelId: "terminal-1",
      projectRootPath: "/repo",
      runId: "run-1",
      status: "running",
      taskId: "package-script:test",
    });
    rememberTerminalTaskRun({
      detail: "pnpm run bootstrap",
      label: "bootstrap",
      panelId: "terminal-other",
      projectRootPath: "/repo",
      runId: "run-2",
      status: "running",
      taskId: "package-script:bootstrap",
    });
    useTaskBackgroundStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "/repo": {
            "package-script:test": {
              label: "test",
              projectRootPath: "/repo",
              runId: "run-1",
              startedAt: 1,
              status: "running",
              taskId: "package-script:test",
              updatedAt: 1,
            },
          },
        },
        version: 1,
      },
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

    const trigger = await screen.findByTestId("task-status-item");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByTestId("task-status-dropdown")).toBeTruthy();
    expect(
      await screen.findByTestId("task-status-dropdown-item-package-script:test")
    ).toBeTruthy();
    const rowStatus = screen.getByTestId(
      "task-status-row-status-package-script:test"
    );
    expect(rowStatus).toHaveAttribute("aria-label", "Running");
    expect(rowStatus).not.toHaveTextContent("Running");
    expect(screen.getByTestId("task-status-row-running-icon")).toBeTruthy();
    expect(
      screen.queryByTestId("task-status-dropdown-item-package-script:bootstrap")
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId("task-status-run-background-package-script:test")
    );
    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: false,
      forceRestart: true,
      mode: "background",
      placement: "active-tab",
      projectRootPath: "/repo",
      taskId: "package-script:test",
    });

    fireEvent.click(
      screen.getByTestId("task-status-open-terminal-package-script:test")
    );
    expect(window.pier.tasks.spawn).toHaveBeenLastCalledWith({
      focus: true,
      forceRestart: true,
      mode: "terminal-tab",
      placement: "active-tab",
      projectRootPath: "/repo",
      taskId: "package-script:test",
    });
  });

  it("uses a non-spinning task list icon when the terminal has history but no running task", async () => {
    installForegroundActivityApi();
    rememberTerminalTaskRun({
      detail: "pnpm run test",
      label: "test",
      panelId: "terminal-1",
      projectRootPath: "/repo",
      runId: "run-1",
      status: "succeeded",
      taskId: "package-script:test",
    });
    useTaskBackgroundStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "/repo": {
            "package-script:test": {
              label: "test",
              projectRootPath: "/repo",
              runId: "run-1",
              startedAt: 1,
              status: "succeeded",
              taskId: "package-script:test",
              updatedAt: 2,
            },
          },
        },
        version: 1,
      },
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

    expect(await screen.findByTestId("task-status-item")).toHaveAttribute(
      "data-task-status",
      "idle"
    );
    expect(screen.getByTestId("task-status-list-icon")).toBeTruthy();
    expect(screen.queryByTestId("task-status-running-icon")).toBeNull();
  });

  it("uses the success status color for succeeded task rows", async () => {
    installForegroundActivityApi();
    rememberTerminalTaskRun({
      detail: "pnpm run test",
      label: "test",
      panelId: "terminal-1",
      projectRootPath: "/repo",
      runId: "run-1",
      status: "succeeded",
      taskId: "package-script:test",
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

    const trigger = await screen.findByTestId("task-status-item");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(
      await screen.findByTestId("task-status-row-status-package-script:test")
    ).toHaveClass("text-[var(--status-success-fg)]");
  });
});
