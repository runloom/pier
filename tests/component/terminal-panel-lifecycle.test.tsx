import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
} from "@shared/contracts/tasks.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  resetTerminalLaunchConfirmationsForTest,
  waitForTerminalLaunch,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
import { TERMINAL_COMPOSER_GAP_PX } from "@/panel-kits/terminal/terminal-composer.tsx";
import { hasRegisteredTerminalAnchor } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useFontStore } from "@/stores/font.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import {
  resetTerminalOverlayFocusForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";
import {
  markFreshTerminalPanel,
  resetFreshTerminalPanelsForTests,
  setFreshTerminalInitialInput,
} from "@/stores/terminal-panel-session-hints.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

interface TerminalRelaunchRequest {
  context?: PanelContext | undefined;
  initialInput?: string | undefined;
  launchId: string;
  panelId: string;
  sequence: number;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
}

type TerminalRelaunchInput = Omit<TerminalRelaunchRequest, "sequence">;

const terminalRelaunchStoreMock = vi.hoisted(() => {
  let sequence = 0;
  const requests = new Map<string, TerminalRelaunchRequest>();
  const listeners = new Set<() => void>();

  return {
    getSnapshot(panelId: string): TerminalRelaunchRequest | null {
      return requests.get(panelId) ?? null;
    },
    requestTerminalRelaunch(request: TerminalRelaunchInput): void {
      sequence += 1;
      requests.set(request.panelId, { ...request, sequence });
      for (const listener of listeners) {
        listener();
      }
    },
    reset(): void {
      sequence = 0;
      requests.clear();
      listeners.clear();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("@/stores/terminal-relaunch.store.ts", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    requestTerminalRelaunch: terminalRelaunchStoreMock.requestTerminalRelaunch,
    useTerminalRelaunchRequest(
      panelId: string
    ): TerminalRelaunchRequest | null {
      return React.useSyncExternalStore(
        terminalRelaunchStoreMock.subscribe,
        () => terminalRelaunchStoreMock.getSnapshot(panelId),
        () => null
      );
    },
  };
});

const requestTerminalRelaunch =
  terminalRelaunchStoreMock.requestTerminalRelaunch;

const popupContextMenuAtMock = vi.hoisted(() => vi.fn(async () => undefined));
const requestTerminalPresentationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/context-menu/use-context-menu.ts", () => ({
  popupContextMenuAt: popupContextMenuAtMock,
}));

vi.mock("@/panel-kits/terminal/terminal-presentation-reconciler.ts", () => ({
  requestTerminalPresentation: requestTerminalPresentationMock,
}));

class TestResizeObserver {
  static observeCount = 0;
  static instances: TestResizeObserver[] = [];
  private readonly cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    TestResizeObserver.instances.push(this);
  }

  observe() {
    TestResizeObserver.observeCount += 1;
  }
  disconnect = vi.fn();
  emit() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

interface TestPanelProps extends IDockviewPanelProps {
  emitActive(event: { isActive: boolean }): void;
  emitDimensions(event: { height: number; width: number }): void;
  emitGroupChange(): void;
  emitVisibility(event: { isVisible: boolean }): void;
}

const taskTab: PanelTabChrome = {
  badge: { label: "package.json" },
  icon: { id: "pier.task", label: "Task" },
  state: { label: "Running", status: "running" },
  title: "test",
  tooltip: {
    lines: [{ label: "Command", value: "pnpm run test" }],
    title: "test",
  },
};

const completedTaskTab: PanelTabChrome = {
  ...taskTab,
  state: {
    colorToken: "success",
    label: "Succeeded",
    status: "succeeded",
  },
};

const taskMetadata: TaskPanelMetadata = {
  cwd: "/Users/xyz/ABC/pier",
  label: "test",
  projectRootPath: "/Users/xyz/ABC/pier",
  rawCommand: "pnpm run test",
  runId: "run-1",
  source: "package-script",
  startedAt: 1_772_000_000_000,
  status: "running",
  taskId: "package-script:test",
};
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createPanelProps(
  options: {
    isActive?: boolean;
    isVisible?: boolean;
    params?: {
      context?: PanelContext;
      /** 旧版持久化 layout 字段；TerminalPanel 必须忽略它。 */
      initialInput?: string;
      launchId?: string;
      tab?: PanelTabChrome;
      task?: TaskPanelMetadata;
      taskOutput?: TaskOutputPanelParams;
    };
  } = {}
): TestPanelProps {
  let isActive = options.isActive ?? true;
  let isVisible = options.isVisible ?? true;
  let onDidActiveChange: ((event: { isActive: boolean }) => void) | null = null;
  let onDidDimensionsChange:
    | ((event: { height: number; width: number }) => void)
    | null = null;
  let onDidGroupChange: (() => void) | null = null;
  let onDidVisibilityChange: ((event: { isVisible: boolean }) => void) | null =
    null;
  const api = {
    group: { id: "group-terminal-1" },
    height: 300,
    id: "terminal-1",
    get isActive() {
      return isActive;
    },
    get isVisible() {
      return isVisible;
    },
    onDidActiveChange: vi.fn(
      (listener: (event: { isActive: boolean }) => void) => {
        onDidActiveChange = listener;
        return { dispose: vi.fn() };
      }
    ),
    onDidDimensionsChange: vi.fn(
      (listener: (event: { height: number; width: number }) => void) => {
        onDidDimensionsChange = listener;
        return { dispose: vi.fn() };
      }
    ),
    onDidGroupChange: vi.fn((listener: () => void) => {
      onDidGroupChange = listener;
      return { dispose: vi.fn() };
    }),
    onDidVisibilityChange: vi.fn(
      (listener: (event: { isVisible: boolean }) => void) => {
        onDidVisibilityChange = listener;
        return { dispose: vi.fn() };
      }
    ),
    setActive: vi.fn(function (this: unknown) {
      if (this !== api) {
        throw new TypeError("setActive must be called as api.setActive()");
      }
    }),
    setTitle: vi.fn(),
    width: 400,
  };
  const props = {
    api,
    containerApi: {},
    params: options.params ?? {},
    emitGroupChange() {
      onDidGroupChange?.();
    },
    emitActive(event: { isActive: boolean }) {
      isActive = event.isActive;
      onDidActiveChange?.(event);
    },
    emitDimensions(event: { height: number; width: number }) {
      onDidDimensionsChange?.(event);
    },
    emitVisibility(event: { isVisible: boolean }) {
      isVisible = event.isVisible;
      onDidVisibilityChange?.(event);
    },
  };
  return props as unknown as TestPanelProps;
}

function agentActivityFor(panelId: string): AgentActivity {
  return {
    agentId: "claude",
    kind: "agent",
    panelId,
    source: "launch",
    spawnedAt: 1,
    subagentCount: 0,
    updatedAt: 1,
    windowId: "test-window",
  };
}

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRootPath: "/Users/xyz/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

describe("TerminalPanel lifecycle", () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  let anchorFrame = {
    height: 300,
    width: 400,
    x: 10,
    y: 20,
  };
  let emitWindowLayoutPulse:
    | ((pulse: { reason: "resize" | "view-zoom" | "zoom" }) => void)
    | null = null;
  let cwdChangeListeners: Array<{
    cb: (event: { context: PanelContext; panelId: string }) => void;
  }> = [];
  let titleChangeListeners: Array<{
    cb: (event: { panelId: string; title: string }) => void;
  }> = [];
  let surfaceCloseListeners: Array<{
    cb: (event: { panelId: string }) => void;
  }> = [];

  let searchStateListeners: Array<{
    cb: (event: { panelId: string; selected: number; total: number }) => void;
  }> = [];

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("en");
    anchorFrame = {
      height: 300,
      width: 400,
      x: 10,
      y: 20,
    };
    emitWindowLayoutPulse = null;
    searchStateListeners = [];
    cwdChangeListeners = [];
    titleChangeListeners = [];
    surfaceCloseListeners = [];
    terminalRelaunchStoreMock.reset();
    resetTerminalLaunchConfirmationsForTest();
    resetFreshTerminalPanelsForTests();

    resetTerminalInputRoutingForTests();
    resetTerminalOverlayFocusForTests();
    TestResizeObserver.observeCount = 0;
    TestResizeObserver.instances = [];
    popupContextMenuAtMock.mockClear();
    requestTerminalPresentationMock.mockClear();
    useFontStore.setState({
      monoFontFamily: "",
      monoFontSize: 13,
      uiFontFamily: "",
    });
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    // M4: composerMounted 现在还要求本面板前台活动是 agent；默认无活动，
    // 需要挂载 composer 的用例显式注入（见 agentActivityFor）。
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 0 },
    });
    useZoomStore.setState({ windowZoomLevel: 0 });
    useWorkspaceStore.setState({ closePanel: vi.fn(async () => true) });
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id)
    );

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("terminal-anchor")) {
        return {
          bottom: anchorFrame.y + anchorFrame.height,
          height: anchorFrame.height,
          left: anchorFrame.x,
          right: anchorFrame.x + anchorFrame.width,
          top: anchorFrame.y,
          width: anchorFrame.width,
          x: anchorFrame.x,
          y: anchorFrame.y,
          toJSON: () => null,
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(
          (
            cb: (pulse: { reason: "resize" | "view-zoom" | "zoom" }) => void
          ) => {
            emitWindowLayoutPulse = cb;
            return vi.fn();
          }
        ),
        agents: {
          prepareLaunchFromSpec: vi.fn(async () => ({
            launchId: "launch-from-spec",
          })),
        },
        terminal: {
          applyHostSnapshot: vi.fn(),
          close: vi.fn(),
          create: vi.fn(async () => ({ ok: true })),
          endSearch: vi.fn(async () => ({ ok: true })),
          hide: vi.fn(),
          navigateSearch: vi.fn(async () => ({ ok: true })),
          onContextMenuRequest: vi.fn(() => vi.fn()),
          onOpenUrl: vi.fn(() => vi.fn()),
          onCwdChange: vi.fn((cb) => {
            const listener = { cb };
            cwdChangeListeners.push(listener);
            return () => {
              cwdChangeListeners = cwdChangeListeners.filter(
                (entry) => entry !== listener
              );
            };
          }),
          onSearchState: vi.fn((cb) => {
            const listener = { cb };
            searchStateListeners.push(listener);
            return () => {
              searchStateListeners = searchStateListeners.filter(
                (entry) => entry !== listener
              );
            };
          }),
          onSurfaceCloseRequest: vi.fn((cb) => {
            const listener = { cb };
            surfaceCloseListeners.push(listener);
            return () => {
              surfaceCloseListeners = surfaceCloseListeners.filter(
                (entry) => entry !== listener
              );
            };
          }),
          onTitleChange: vi.fn((cb) => {
            const listener = { cb };
            titleChangeListeners.push(listener);
            return () => {
              titleChangeListeners = titleChangeListeners.filter(
                (entry) => entry !== listener
              );
            };
          }),
          readSession: vi.fn(async () => null),
          search: vi.fn(async () => ({ ok: true })),
          setFont: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    terminalStatusItemRegistry.clearForTests();
    resetTerminalInputRoutingForTests();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    resetFreshTerminalPanelsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the native terminal alive when React unmounts during renderer reload", async () => {
    const { unmount } = render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });

    unmount();

    expect(window.pier.terminal.close).not.toHaveBeenCalled();
  });

  it("closes its workspace panel after the exited terminal accepts a key", async () => {
    render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });

    act(() => {
      for (const listener of surfaceCloseListeners) {
        listener.cb({ panelId: "terminal-2" });
      }
    });
    expect(useWorkspaceStore.getState().closePanel).not.toHaveBeenCalled();

    act(() => {
      for (const listener of surfaceCloseListeners) {
        listener.cb({ panelId: "terminal-1" });
      }
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().closePanel).toHaveBeenCalledOnce();
      expect(useWorkspaceStore.getState().closePanel).toHaveBeenCalledWith(
        "terminal-1"
      );
    });
  });

  it("keeps a task output panel open when its surface requests close", async () => {
    const taskOutput = {
      label: "Build",
      runId: "run-1",
      taskId: "build",
    };

    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            tab: { title: taskOutput.label },
            taskOutput,
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          panelId: "terminal-1",
          taskOutput,
        })
      );
    });

    act(() => {
      for (const listener of surfaceCloseListeners) {
        listener.cb({ panelId: "terminal-1" });
      }
    });

    expect(useWorkspaceStore.getState().closePanel).not.toHaveBeenCalled();
  });

  it("creates a task output surface without mounting runtime controls", async () => {
    const taskOutput = {
      label: "Build",
      runId: "run-1",
      taskId: "build",
    };
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-1": {
            mode: "background",
            nodes: {
              build: {
                label: "Build",
                panelId: "background-task-run-1-build",
                status: "running",
                taskId: "build",
              },
            },
            originPanelId: "terminal-origin",
            projectRootPath: "/repo",
            rootTaskId: "build",
            runId: "run-1",
            startedAt: 100,
            status: "running",
            updatedAt: 200,
          },
        },
        version: 1,
      },
    });

    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            tab: { title: taskOutput.label },
            taskOutput,
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          panelId: "terminal-1",
          taskOutput,
        })
      );
    });
    expect(document.querySelector(".terminal-anchor")).not.toBeNull();
    expect(screen.queryByTestId("task-output-log")).toBeNull();
    expect(screen.queryByTestId("terminal-runtime-control")).toBeNull();
  });

  it("restores the saved tab descriptor before creating a hidden native terminal", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      title: "Claude Code",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const visibleAnchorFrame = anchorFrame;
    anchorFrame = { height: 0, width: 0, x: 0, y: 0 };
    const props = createPanelProps({ isActive: false, isVisible: false });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("pier");
    });
    expect(props.api.setTitle).not.toHaveBeenCalledWith("Terminal");
    expect(window.pier.terminal.create).not.toHaveBeenCalled();

    anchorFrame = visibleAnchorFrame;
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
  });

  it("creates a native terminal for a newly active terminal panel before visibility settles", async () => {
    const props = createPanelProps({ isActive: true, isVisible: false });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
  });

  it("skips session restore for freshly created terminal panels", async () => {
    vi.mocked(window.pier.terminal.readSession).mockImplementation(
      () => new Promise(() => undefined)
    );
    markFreshTerminalPanel("terminal-1");
    const props = createPanelProps({
      params: {
        context,
        launchId: "launch-1",
        tab: taskTab,
        task: taskMetadata,
      },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          launchId: "launch-1",
          panelId: "terminal-1",
          tab: taskTab,
          task: taskMetadata,
        })
      );
    });
    expect(window.pier.terminal.readSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("test");
    });
  });

  it("creates a native terminal for a hidden panel once it becomes active with a renderable anchor", async () => {
    const props = createPanelProps({ isActive: false, isVisible: false });

    render(<TerminalPanel {...props} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(window.pier.terminal.create).not.toHaveBeenCalled();

    act(() => {
      props.emitActive({ isActive: true });
    });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
  });

  it("creates a native terminal for compact split panels below 100px tall", async () => {
    anchorFrame = {
      height: 93,
      width: 213,
      x: 0,
      y: 72,
    };
    const props = createPanelProps({ isActive: true, isVisible: true });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frame: expect.objectContaining({
            height: 93,
            width: 213,
            x: 0,
            y: 72,
          }),
          panelId: "terminal-1",
        })
      );
    });
  });

  it("passes panel context into native terminal creation", async () => {
    render(
      <TerminalPanel
        {...createPanelProps({
          params: { context },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          panelId: "terminal-1",
        })
      );
    });
  });

  it("renders plugin terminal status items below the native terminal anchor", async () => {
    terminalStatusItemRegistry.register({
      id: "test.worktree-status",
      isVisible: ({ context: panelContext }) =>
        Boolean(panelContext?.worktreeRoot),
      render: ({ context: panelContext }) => (
        <span>{panelContext?.worktreeRoot ?? "missing"}</span>
      ),
    });

    const { container, findByTestId } = render(
      <TerminalPanel
        {...createPanelProps({
          params: { context },
        })}
      />
    );

    const statusBar = await findByTestId("terminal-status-bar");
    expect(statusBar).toHaveTextContent("/Users/xyz/ABC/pier");
    expect(
      container.querySelector(".terminal-anchor")?.className ?? ""
    ).toContain("bottom-[var(--terminal-content-bottom)]");
  });

  it("mounts the terminal status bar for a panel with task metadata", async () => {
    const { container, findByTestId } = render(
      <TerminalPanel
        {...createPanelProps({
          params: { context, tab: taskTab, task: taskMetadata },
        })}
      />
    );

    const statusBar = await findByTestId("terminal-status-bar");
    expect(
      statusBar.querySelector('[data-testid="terminal-status-bar-spacer"]')
    ).not.toBeNull();
    expect(
      container.querySelector(".terminal-anchor")?.className ?? ""
    ).toContain("bottom-[var(--terminal-content-bottom)]");
  });

  it("keeps the status bar mounted when no item is visible for the panel", async () => {
    terminalStatusItemRegistry.register({
      id: "test.worktree-status",
      isVisible: ({ context: panelContext }) =>
        Boolean(panelContext?.worktreeRoot),
      render: () => <span>worktree</span>,
    });

    const { container, findByTestId } = render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context: {
              contextId: "ctx-home",
              cwd: "/Users/xyz",
              openedPath: "/Users/xyz",
              projectRootPath: "/Users/xyz",
              source: "panel",
              updatedAt: 1_772_000_000_000,
            },
          },
        })}
      />
    );

    const statusBar = await findByTestId("terminal-status-bar");
    expect(statusBar).not.toHaveTextContent("worktree");
    expect(
      statusBar.querySelector('[data-testid="terminal-status-bar-spacer"]')
    ).not.toBeNull();
    expect(
      container.querySelector(".terminal-anchor")?.className ?? ""
    ).toContain("bottom-[var(--terminal-content-bottom)]");
  });

  it("passes launchId into native terminal creation", async () => {
    markFreshTerminalPanel("terminal-1");
    setFreshTerminalInitialInput("terminal-1", "修复终端焦点问题\r");
    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          initialInput: "修复终端焦点问题\r",
          launchId: "launch-1",
          panelId: "terminal-1",
        })
      );
    });
  });

  it("confirms a renderer terminal launch only after native creation succeeds", async () => {
    const confirmation = waitForTerminalLaunch("launch-confirmed");
    markFreshTerminalPanel("terminal-1");

    render(
      <TerminalPanel
        {...createPanelProps({
          params: { context, launchId: "launch-confirmed" },
        })}
      />
    );

    await expect(confirmation).resolves.toBeUndefined();
    expect(window.pier.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ launchId: "launch-confirmed" })
    );
  });

  it("rejects a renderer terminal launch when native creation fails", async () => {
    vi.mocked(window.pier.terminal.create).mockResolvedValueOnce({
      error: "native create failed",
      ok: false,
    });
    const confirmation = waitForTerminalLaunch("launch-failed");
    markFreshTerminalPanel("terminal-1");

    render(
      <TerminalPanel
        {...createPanelProps({
          params: { context, launchId: "launch-failed" },
        })}
      />
    );

    await expect(confirmation).rejects.toThrow("native create failed");
  });

  it("does not replay initial input from persisted panel params", async () => {
    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            initialInput: "不应再次发送\r",
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          initialInput: "不应再次发送\r",
        })
      );
    });
  });

  it("awaits terminal close before relaunching the same panel and resets runtime descriptor state", async () => {
    const closeDeferred = createDeferred<void>();
    vi.mocked(window.pier.terminal.close).mockImplementationOnce(
      () => closeDeferred.promise
    );
    const firstRuntimeContext: PanelContext = {
      ...context,
      contextId: "ctx-old-runtime",
      cwd: "/Users/xyz/ABC/pier/old-run",
      openedPath: "/Users/xyz/ABC/pier/old-run",
      updatedAt: 1_772_000_001_000,
      worktreeKey: "/Users/xyz/ABC/pier/old-run",
      worktreeRoot: "/Users/xyz/ABC/pier/old-run",
    };
    const relaunchContext: PanelContext = {
      ...context,
      contextId: "ctx-relaunch",
      cwd: "/Users/xyz/ABC/pier/packages/app",
      openedPath: "/Users/xyz/ABC/pier/packages/app",
      updatedAt: 1_772_000_002_000,
      worktreeKey: "/Users/xyz/ABC/pier/packages/app",
      worktreeRoot: "/Users/xyz/ABC/pier/packages/app",
    };
    const relaunchTab: PanelTabChrome = {
      badge: { label: "app" },
      icon: { id: "pier.task", label: "Task" },
      state: { label: "Relaunching", status: "running" },
      title: "lint",
      tooltip: {
        lines: [{ label: "Command", value: "pnpm run lint" }],
        title: "lint",
      },
    };
    const relaunchTask: TaskPanelMetadata = {
      ...taskMetadata,
      cwd: "/Users/xyz/ABC/pier/packages/app",
      label: "lint",
      rawCommand: "pnpm run lint",
      runId: "run-2",
      startedAt: 1_772_000_002_000,
      taskId: "package-script:lint",
    };
    const props = createPanelProps({
      params: {
        context,
        launchId: "launch-1",
        tab: taskTab,
        task: taskMetadata,
      },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          launchId: "launch-1",
          panelId: "terminal-1",
          tab: taskTab,
          task: taskMetadata,
        })
      );
    });

    act(() => {
      for (const listener of cwdChangeListeners) {
        listener.cb({ context: firstRuntimeContext, panelId: "terminal-1" });
      }
      for (const listener of titleChangeListeners) {
        listener.cb({ panelId: "terminal-1", title: "old runtime title" });
      }
    });

    await waitFor(() => {
      expect(
        usePanelDescriptorStore.getState().descriptors["terminal-1"]
      ).toMatchObject({
        context: firstRuntimeContext,
        display: {
          long: "old runtime title",
          short: "test",
          terminalTitle: "old runtime title",
        },
        tab: expect.objectContaining({
          title: "test",
        }),
      });
    });

    act(() => {
      requestTerminalRelaunch({
        context: relaunchContext,
        launchId: "launch-2",
        panelId: "terminal-1",
        tab: relaunchTab,
        task: relaunchTask,
      });
    });

    await waitFor(() => {
      expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1", {
        reason: "relaunch",
      });
    });
    expect(window.pier.terminal.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      closeDeferred.resolve();
      await closeDeferred.promise;
    });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledTimes(2);
    });
    expect(window.pier.terminal.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: relaunchContext,
        launchId: "launch-2",
        panelId: "terminal-1",
        tab: relaunchTab,
        task: relaunchTask,
      })
    );

    await waitFor(() => {
      const descriptor =
        usePanelDescriptorStore.getState().descriptors["terminal-1"];
      expect(descriptor?.context).toEqual(relaunchContext);
      expect(descriptor?.display).toEqual({
        long: relaunchContext.cwd,
        short: "lint",
      });
      expect(descriptor?.tab).toEqual(relaunchTab);
    });

    const postRelaunchContext: PanelContext = {
      ...relaunchContext,
      contextId: "ctx-relaunch-runtime",
      cwd: "/Users/xyz/ABC/pier/packages/app/src",
      openedPath: "/Users/xyz/ABC/pier/packages/app/src",
      updatedAt: 1_772_000_002_500,
      worktreeKey: "/Users/xyz/ABC/pier/packages/app/src",
      worktreeRoot: "/Users/xyz/ABC/pier/packages/app/src",
    };

    act(() => {
      for (const listener of cwdChangeListeners) {
        listener.cb({ context: postRelaunchContext, panelId: "terminal-1" });
      }
      for (const listener of titleChangeListeners) {
        listener.cb({ panelId: "terminal-1", title: "new runtime title" });
      }
    });

    await waitFor(() => {
      expect(
        usePanelDescriptorStore.getState().descriptors["terminal-1"]
      ).toMatchObject({
        context: postRelaunchContext,
        display: {
          long: "new runtime title",
          short: "lint",
          terminalTitle: "new runtime title",
        },
        tab: relaunchTab,
      });
    });
  });

  it("renders relaunch close failures without creating a replacement native terminal", async () => {
    const closeError = new Error("close boom");
    vi.mocked(window.pier.terminal.close).mockRejectedValueOnce(closeError);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const relaunchContext: PanelContext = {
      ...context,
      contextId: "ctx-relaunch-close-error",
      cwd: "/Users/xyz/ABC/pier/packages/app",
      openedPath: "/Users/xyz/ABC/pier/packages/app",
      updatedAt: 1_772_000_002_750,
      worktreeKey: "/Users/xyz/ABC/pier/packages/app",
      worktreeRoot: "/Users/xyz/ABC/pier/packages/app",
    };
    const relaunchTab: PanelTabChrome = {
      badge: { label: "app" },
      icon: { id: "pier.task", label: "Task" },
      state: { label: "Relaunching", status: "running" },
      title: "lint",
      tooltip: {
        lines: [{ label: "Command", value: "pnpm run lint" }],
        title: "lint",
      },
    };
    const relaunchTask: TaskPanelMetadata = {
      ...taskMetadata,
      cwd: "/Users/xyz/ABC/pier/packages/app",
      label: "lint",
      rawCommand: "pnpm run lint",
      runId: "run-2",
      startedAt: 1_772_000_002_750,
      taskId: "package-script:lint",
    };
    const { container, findByText } = render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            tab: taskTab,
            task: taskMetadata,
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          launchId: "launch-1",
          panelId: "terminal-1",
        })
      );
    });

    act(() => {
      requestTerminalRelaunch({
        context: relaunchContext,
        launchId: "launch-2",
        panelId: "terminal-1",
        tab: relaunchTab,
        task: relaunchTask,
      });
    });

    await waitFor(() => {
      expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1", {
        reason: "relaunch",
      });
    });
    const errorText = await findByText("close boom");
    expect(window.pier.terminal.create).toHaveBeenCalledTimes(1);
    const root = container.querySelector('[data-testid="terminal-panel-root"]');
    expect(root?.className ?? "").not.toContain("--terminal-background");
    expect(errorText.parentElement?.className ?? "").toContain(
      "--terminal-background"
    );
  });

  it("ignores stale terminal create completions after relaunch cleanup", async () => {
    const firstCreate = createDeferred<{ ok: true }>();
    const secondCreate = createDeferred<{ ok: true }>();
    const closeDeferred = createDeferred<void>();
    vi.mocked(window.pier.terminal.create)
      .mockImplementationOnce(() => firstCreate.promise)
      .mockImplementationOnce(() => secondCreate.promise);
    vi.mocked(window.pier.terminal.close).mockImplementationOnce(
      () => closeDeferred.promise
    );
    const relaunchContext: PanelContext = {
      ...context,
      contextId: "ctx-relaunch-race",
      cwd: "/Users/xyz/ABC/pier/packages/app",
      openedPath: "/Users/xyz/ABC/pier/packages/app",
      updatedAt: 1_772_000_003_000,
      worktreeKey: "/Users/xyz/ABC/pier/packages/app",
      worktreeRoot: "/Users/xyz/ABC/pier/packages/app",
    };
    const relaunchTab: PanelTabChrome = {
      badge: { label: "app" },
      icon: { id: "pier.task", label: "Task" },
      state: { label: "Relaunching", status: "running" },
      title: "lint",
      tooltip: {
        lines: [{ label: "Command", value: "pnpm run lint" }],
        title: "lint",
      },
    };
    const relaunchTask: TaskPanelMetadata = {
      ...taskMetadata,
      cwd: "/Users/xyz/ABC/pier/packages/app",
      label: "lint",
      rawCommand: "pnpm run lint",
      runId: "run-2",
      startedAt: 1_772_000_003_000,
      taskId: "package-script:lint",
    };

    const { container } = render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            tab: taskTab,
            task: taskMetadata,
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          launchId: "launch-1",
          panelId: "terminal-1",
        })
      );
    });
    expect(
      container.querySelector('[data-testid="terminal-placeholder"]')
    ).not.toBeNull();
    expect(hasRegisteredTerminalAnchor("terminal-1")).toBe(false);

    act(() => {
      requestTerminalRelaunch({
        context: relaunchContext,
        launchId: "launch-2",
        panelId: "terminal-1",
        tab: relaunchTab,
        task: relaunchTask,
      });
    });

    await waitFor(() => {
      expect(window.pier.terminal.close).toHaveBeenCalled();
    });
    expect(vi.mocked(window.pier.terminal.close).mock.calls.at(-1)?.[0]).toBe(
      "terminal-1"
    );
    expect(window.pier.terminal.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      closeDeferred.resolve();
      await closeDeferred.promise;
    });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledTimes(2);
    });
    expect(window.pier.terminal.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: relaunchContext,
        launchId: "launch-2",
        panelId: "terminal-1",
        tab: relaunchTab,
        task: relaunchTask,
      })
    );
    requestTerminalPresentationMock.mockClear();

    await act(async () => {
      firstCreate.resolve({ ok: true });
      await firstCreate.promise;
    });

    expect(
      container.querySelector('[data-testid="terminal-placeholder"]')
    ).not.toBeNull();
    expect(hasRegisteredTerminalAnchor("terminal-1")).toBe(false);
    expect(requestTerminalPresentationMock).not.toHaveBeenCalled();

    await act(async () => {
      secondCreate.resolve({ ok: true });
      await secondCreate.promise;
    });

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="terminal-placeholder"]')
      ).toBeNull();
      expect(hasRegisteredTerminalAnchor("terminal-1")).toBe(true);
    });
    expect(requestTerminalPresentationMock).toHaveBeenCalledTimes(1);
    expect(requestTerminalPresentationMock).toHaveBeenCalledWith("visibility");
  });

  it("uses tab chrome params for descriptor title and native creation metadata", async () => {
    const props = createPanelProps({
      params: {
        context,
        launchId: "launch-1",
        tab: taskTab,
        task: taskMetadata,
      },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("test");
    });
    expect(
      usePanelDescriptorStore.getState().descriptors["terminal-1"]
    ).toMatchObject({
      tab: taskTab,
    });
    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          panelId: "terminal-1",
          tab: taskTab,
          task: taskMetadata,
        })
      );
    });
  });

  it("restores tab chrome from a saved terminal session", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      tab: taskTab,
      title: "vite",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const props = createPanelProps();

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("test");
    });
    expect(
      usePanelDescriptorStore.getState().descriptors["terminal-1"]
    ).toMatchObject({
      display: { terminalTitle: "vite" },
      tab: taskTab,
    });
  });

  it("prefers saved task tab status over stale layout params", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      tab: completedTaskTab,
      task: { ...taskMetadata, exitCode: 0, status: "succeeded" },
      title: "test",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const props = createPanelProps({
      params: {
        context,
        launchId: "launch-1",
        tab: taskTab,
        task: taskMetadata,
      },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(
        usePanelDescriptorStore.getState().descriptors["terminal-1"]
      ).toMatchObject({
        tab: {
          state: {
            label: "Succeeded",
            status: "succeeded",
          },
        },
      });
    });
  });

  it("renders restored completed task as a result view without native terminal", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      tab: completedTaskTab,
      task: { ...taskMetadata, exitCode: 0, status: "succeeded" },
      title: "test",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });

    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            tab: taskTab,
            task: taskMetadata,
          },
        })}
      />
    );

    const result = await screen.findByTestId("terminal-task-result");
    expect(result).toHaveClass("px-2", "py-1.5", "font-mono");
    expect(result).toHaveAttribute("data-scrollbar", "stable");
    expect(result).not.toHaveClass("p-4", "text-sm");
    expect(result).toHaveStyle({ fontSize: "13px" });
    expect(result).toHaveTextContent("[pier] restored task");
    expect(result).toHaveTextContent("Tasktest");
    expect(result).toHaveTextContent("Statussucceeded");
    expect(result).toHaveTextContent("Commandpnpm run test");
    expect(window.pier.terminal.create).not.toHaveBeenCalled();

    fireEvent.contextMenu(result, { clientX: 18, clientY: 30 });
    await waitFor(() => {
      expect(popupContextMenuAtMock).toHaveBeenCalledWith(
        "terminal/content",
        { x: 18, y: 30 },
        {
          sourcePanelComponent: "terminal",
          sourcePanelContext: context,
          sourcePanelGroupId: "group-terminal-1",
          sourcePanelId: "terminal-1",
        }
      );
    });
  });

  it("renders a swept running task as a cancelled result card on app restart", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      tab: {
        ...taskTab,
        state: {
          colorToken: "warning",
          label: "Cancelled",
          status: "cancelled",
        },
      },
      task: taskMetadata,
      title: "test",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });

    render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            tab: taskTab,
            task: taskMetadata,
          },
        })}
      />
    );

    const result = await screen.findByTestId("terminal-task-result");
    expect(result).toHaveAttribute("data-scrollbar", "stable");
    expect(result).toHaveTextContent("Tasktest");
    expect(result).toHaveTextContent("Statuscancelled");
    expect(window.pier.terminal.create).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        usePanelDescriptorStore.getState().descriptors["terminal-1"]?.tab?.state
      ).toMatchObject({
        colorToken: "warning",
        label: "Cancelled",
        status: "cancelled",
      });
    });
  });

  it("remounts a live running task as a real terminal on renderer reload", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context,
      tab: taskTab,
      task: taskMetadata,
      taskLive: true,
      title: "test",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });

    const { container, queryByTestId } = render(
      <TerminalPanel
        {...createPanelProps({
          params: {
            context,
            launchId: "launch-1",
            tab: taskTab,
            task: taskMetadata,
          },
        })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    expect(queryByTestId("terminal-task-result")).toBeNull();
    expect(container.querySelector(".terminal-anchor")).not.toBeNull();
  });

  it("renders restored exited agent as a result view without native terminal", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      agent: {
        agentId: "claude",
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        launch: {
          agentId: "claude",
          command: "claude --dangerously-skip-permissions",
          cwd: "/Users/xyz/ABC/pier",
        },
        startedAt: 1_772_000_000_000,
        status: "exited",
      },
      context,
      tab: {
        icon: { id: "agent:claude" },
        title: "Claude",
      },
      title: "Claude",
      updatedAt: "2026-07-06T00:00:00.000Z",
    } as TerminalPanelSessionSnapshot);

    render(<TerminalPanel {...createPanelProps({ params: { context } })} />);

    const result = await screen.findByTestId("terminal-agent-result");
    expect(result).toHaveAttribute("data-scrollbar", "stable");
    expect(result).toHaveTextContent("Agent ended");
    expect(result).toHaveTextContent(
      "The previous session has exited. You can start it again."
    );
    expect(result).toHaveTextContent("AgentClaude");
    expect(result).toHaveTextContent("Statusexited");
    expect(result).toHaveTextContent(
      "Commandclaude --dangerously-skip-permissions"
    );
    expect(
      screen.getByRole("button", { name: "Restart agent" })
    ).toBeInTheDocument();
    expect(window.pier.terminal.create).not.toHaveBeenCalled();
  });

  it("skips native create for exited agent even when an anchor would be available", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      agent: {
        agentId: "claude",
        exitCode: 1,
        finishedAt: 1_772_000_001_000,
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/Users/xyz/ABC/pier",
        },
        startedAt: 1_772_000_000_000,
        status: "exited",
      },
      context,
      updatedAt: "2026-07-06T00:00:00.000Z",
    } as TerminalPanelSessionSnapshot);

    const { container } = render(
      <TerminalPanel {...createPanelProps({ params: { context } })} />
    );

    await screen.findByTestId("terminal-agent-result");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(container.querySelector(".terminal-anchor")).toBeNull();
    expect(window.pier.terminal.create).not.toHaveBeenCalled();
  });

  it("restarts an exited agent from the saved launch via relaunch store", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      agent: {
        agentId: "claude",
        exitCode: 0,
        finishedAt: 1_772_000_001_000,
        launch: {
          agentId: "claude",
          command: "claude --dangerously-skip-permissions",
          cwd: "/Users/xyz/ABC/pier",
        },
        startedAt: 1_772_000_000_000,
        status: "exited",
      },
      context,
      tab: {
        icon: { id: "agent:claude" },
        title: "Claude",
      },
      title: "Claude",
      updatedAt: "2026-07-06T00:00:00.000Z",
    } as TerminalPanelSessionSnapshot);
    vi.mocked(window.pier.terminal.close).mockResolvedValue(undefined);

    render(<TerminalPanel {...createPanelProps({ params: { context } })} />);

    const restartButton = await screen.findByRole("button", {
      name: "Restart agent",
    });
    await act(async () => {
      fireEvent.click(restartButton);
    });

    await waitFor(() => {
      expect(window.pier.agents.prepareLaunchFromSpec).toHaveBeenCalledWith({
        agentId: "claude",
        command: "claude --dangerously-skip-permissions",
        cwd: "/Users/xyz/ABC/pier",
      });
    });
    await waitFor(() => {
      expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1", {
        reason: "relaunch",
      });
    });
    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          launchId: "launch-from-spec",
          panelId: "terminal-1",
          context: expect.objectContaining({
            cwd: "/Users/xyz/ABC/pier",
          }),
        })
      );
    });
  });

  it("creates a native terminal for running agent session without resume id", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      agent: {
        agentId: "claude",
        launch: {
          agentId: "claude",
          command: "claude",
          cwd: "/Users/xyz/ABC/pier",
        },
        startedAt: 1_772_000_000_000,
        status: "running",
      },
      context,
      tab: {
        icon: { id: "agent:claude" },
        title: "Claude",
      },
      title: "Claude",
      updatedAt: "2026-07-06T00:00:00.000Z",
    } as TerminalPanelSessionSnapshot);

    const { container } = render(
      <TerminalPanel {...createPanelProps({ params: { context } })} />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    expect(screen.queryByTestId("terminal-agent-result")).toBeNull();
    expect(container.querySelector(".terminal-anchor")).not.toBeNull();
  });

  it("does not restart native terminal creation when context params trigger rerenders", async () => {
    const props = createPanelProps({
      params: { context },
    });
    const { container } = render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="terminal-placeholder"]')
      ).toBeNull();
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(window.pier.terminal.create).toHaveBeenCalledTimes(1);
  });

  it("reports panel context through the descriptor", async () => {
    const props = createPanelProps({ params: { context } });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("pier");
    });
    expect(
      usePanelDescriptorStore.getState().descriptors["terminal-1"]
    ).toEqual(
      expect.objectContaining({
        context,
        display: expect.objectContaining({ short: "pier" }),
      })
    );
  });

  it("passes panel context immediately and leaves saved context precedence to main", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      context: {
        ...context,
        contextId: "ctx-current-work",
        cwd: "/Users/xyz/ABC/current-work",
        openedPath: "/Users/xyz/ABC/current-work",
        projectRootPath: "/Users/xyz/ABC/current-work",
        worktreeKey: "/Users/xyz/ABC/current-work",
      },
      title: "Claude Code",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const props = createPanelProps({
      isActive: true,
      params: { context },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          panelId: "terminal-1",
        })
      );
    });
  });

  it("shows a terminal-colored placeholder until the native terminal is ready", async () => {
    let resolveCreate!: (value: { ok: true }) => void;
    vi.mocked(window.pier.terminal.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    const props = createPanelProps();

    const { container } = render(<TerminalPanel {...props} />);

    const root = container.querySelector('[data-testid="terminal-panel-root"]');
    const placeholder = container.querySelector(
      '[data-testid="terminal-placeholder"]'
    );
    expect(root?.className ?? "").not.toContain("--terminal-background");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.className ?? "").toContain("--terminal-background");

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    resolveCreate({ ok: true });

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="terminal-placeholder"]')
      ).toBeNull();
    });
  });

  it("keeps terminal create failures on the terminal-colored surface", async () => {
    vi.mocked(window.pier.terminal.create).mockResolvedValueOnce({
      error: "终端创建失败",
      ok: false,
    });
    const props = createPanelProps();

    const { container, findByText } = render(<TerminalPanel {...props} />);

    const errorText = await findByText("终端创建失败");
    const root = container.querySelector('[data-testid="terminal-panel-root"]');
    expect(root?.className ?? "").not.toContain("--terminal-background");
    expect(errorText.parentElement?.className ?? "").toContain(
      "--terminal-background"
    );
  });

  it("recovers from transient coordinate loss during native create without leaving an error overlay", async () => {
    const visibleFrame = { height: 300, width: 400, x: 10, y: 20 };
    const missingFrame = { height: 0, width: 0, x: 0, y: 0 };
    let stableCoordinates = false;
    let waitForRealSizeReads = 0;
    const rectFor = (frame: typeof visibleFrame): DOMRect =>
      ({
        bottom: frame.y + frame.height,
        height: frame.height,
        left: frame.x,
        right: frame.x + frame.width,
        top: frame.y,
        width: frame.width,
        x: frame.x,
        y: frame.y,
        toJSON: () => null,
      }) as DOMRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("terminal-anchor")) {
        const stack =
          new Error("capture stack for waitForRealSize test").stack ?? "";
        if (!stableCoordinates && stack.includes("waitForRealSize")) {
          waitForRealSizeReads += 1;
          return rectFor(
            waitForRealSizeReads === 1 ? visibleFrame : missingFrame
          );
        }
        return rectFor(stableCoordinates ? visibleFrame : missingFrame);
      }
      return originalGetBoundingClientRect.call(this);
    };
    const props = createPanelProps();

    const { container } = render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(waitForRealSizeReads).toBeGreaterThan(0);
    });
    await act(async () => undefined);
    stableCoordinates = true;
    act(() => {
      props.emitDimensions({
        height: visibleFrame.height,
        width: visibleFrame.width,
      });
    });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frame: expect.objectContaining(visibleFrame),
          panelId: "terminal-1",
        })
      );
    });
    expect(screen.queryByText("无法获取面板坐标")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="terminal-placeholder"]')
    ).toBeNull();
  });

  it("offers a retry action after a terminal create failure that clears the error and calls create again", async () => {
    const retryCreate = createDeferred<{ ok: true }>();
    vi.mocked(window.pier.terminal.create)
      .mockResolvedValueOnce({
        error: "终端创建失败",
        ok: false,
      })
      .mockImplementationOnce(() => retryCreate.promise);
    const props = createPanelProps();

    const { findByText } = render(<TerminalPanel {...props} />);

    expect(await findByText("终端创建失败")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "重试" });
    act(() => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("终端创建失败")).not.toBeInTheDocument();

    await act(async () => {
      retryCreate.resolve({ ok: true });
      await retryCreate.promise;
    });
  });

  it("sends a trailing native frame after window layout pulses settle", async () => {
    render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });

    emitWindowLayoutPulse?.({ reason: "view-zoom" });
    anchorFrame = {
      height: 620,
      width: 900,
      x: 10,
      y: 20,
    };
  });

  it("applies effective terminal font size from window zoom without changing the base preference", async () => {
    useFontStore.setState({ monoFontSize: 13 });
    useZoomStore.setState({ windowZoomLevel: 2 });
    render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          font: expect.objectContaining({ size: 18.7 }),
        })
      );
    });
    expect(useFontStore.getState().monoFontSize).toBe(13);

    vi.mocked(window.pier.terminal.setFont).mockClear();
    act(() => {
      useZoomStore.setState({ windowZoomLevel: 1 });
    });

    await waitFor(() => {
      expect(window.pier.terminal.setFont).toHaveBeenCalledWith(
        "terminal-1",
        expect.objectContaining({ size: 15.6 })
      );
    });
    expect(useFontStore.getState().monoFontSize).toBe(13);
  });

  it("refocuses an active native terminal when dockview shows it after tab drag", async () => {
    const props = createPanelProps({ isActive: true });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    requestTerminalPresentationMock.mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
        "visibility"
      );
    });
  });

  it("resyncs an active native terminal when dockview moves it to another group", async () => {
    const props = createPanelProps({ isActive: true });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    requestTerminalPresentationMock.mockClear();

    props.emitGroupChange();

    await waitFor(() => {
      expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
        "dockview-layout"
      );
    });
  });

  it("does not focus a terminal that becomes visible while inactive", async () => {
    const props = createPanelProps({ isActive: false });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    requestTerminalPresentationMock.mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
        "visibility"
      );
    });
  });

  it("does not focus a terminal moved between groups while hidden", async () => {
    const props = createPanelProps({ isActive: true, isVisible: false });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    props.emitGroupChange();
  });

  it("opens the terminal search bar for its panel and focuses the input", async () => {
    render(<TerminalPanel {...createPanelProps()} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-search", {
          detail: { panelId: "terminal-1" },
        })
      );
    });

    const search = await screen.findByTestId("terminal-search-bar");
    const input = screen.getByTestId("terminal-search-input");

    expect(search).toHaveAccessibleName("Find in terminal");
    expect(input).toHaveFocus();
  });

  it("yields keyboard to the terminal on focus intent while the search bar stays mounted", async () => {
    setTerminalBasePanel({
      kind: "terminal",
      panelId: "terminal-1",
    });
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    render(<TerminalPanel {...createPanelProps()} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-search", {
          detail: { panelId: "terminal-1" },
        })
      );
    });
    await screen.findByTestId("terminal-search-input");

    // 打开搜索 → 持有一次 web 请求，basePanel 仍是 terminal-1。
    await waitFor(() => {
      expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          basePanel: { kind: "terminal", panelId: "terminal-1" },
          webRequestCount: 1,
        })
      );
    });

    // 模拟终端焦点意图（onFocusRequest 处理器走的同一组 store API）：
    // 让出键盘 + 把 basePanel 置为 terminal。
    act(() => {
      useTerminalStore.getState().yieldToTerminal();
      setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
    });

    // effective 随 basePanel=terminal —— web 请求归零；搜索栏仍然挂载（共存）。
    await waitFor(() => {
      expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          basePanel: { kind: "terminal", panelId: "terminal-1" },
          webRequestCount: 0,
        })
      );
    });
    expect(screen.getByTestId("terminal-search-bar")).toBeInTheDocument();

    // 用户点回输入框（onFocus）→ 重新激活，web 请求恢复为 1，搜索栏从未卸载。
    fireEvent.focus(screen.getByTestId("terminal-search-input"));
    await waitFor(() => {
      expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({ webRequestCount: 1 })
      );
    });
    expect(screen.getByTestId("terminal-search-bar")).toBeInTheDocument();
  });

  it("runs terminal search and keyboard navigation from the search bar", async () => {
    render(<TerminalPanel {...createPanelProps()} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-search", {
          detail: { panelId: "terminal-1" },
        })
      );
    });
    const input = await screen.findByTestId("terminal-search-input");

    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    await waitFor(() => {
      expect(window.pier.terminal.search).toHaveBeenCalledWith(
        "terminal-1",
        "needle"
      );
    });
    expect(window.pier.terminal.navigateSearch).toHaveBeenCalledWith(
      "terminal-1",
      "next"
    );
    expect(window.pier.terminal.navigateSearch).toHaveBeenCalledWith(
      "terminal-1",
      "previous"
    );
  });

  it("shows terminal search result state and closes cleanly", async () => {
    render(<TerminalPanel {...createPanelProps()} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-search", {
          detail: { panelId: "terminal-1" },
        })
      );
    });
    const input = await screen.findByTestId("terminal-search-input");
    fireEvent.change(input, { target: { value: "needle" } });

    act(() => {
      for (const listener of searchStateListeners) {
        listener.cb({ panelId: "terminal-1", selected: 1, total: 3 });
      }
    });

    expect(screen.getByTestId("terminal-search-match-count")).toHaveTextContent(
      "2 / 3"
    );

    act(() => {
      for (const listener of searchStateListeners) {
        listener.cb({ panelId: "terminal-1", selected: -1, total: 0 });
      }
    });

    expect(screen.getByTestId("terminal-search-match-count")).toHaveTextContent(
      "No matches"
    );

    fireEvent.keyDown(input, { key: "Escape" });

    expect(window.pier.terminal.endSearch).toHaveBeenCalledWith("terminal-1");
    expect(screen.queryByTestId("terminal-search-bar")).toBeNull();
  });

  it("closes terminal search from the close button", async () => {
    render(<TerminalPanel {...createPanelProps()} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-search", {
          detail: { panelId: "terminal-1" },
        })
      );
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Close search" })
    );

    expect(window.pier.terminal.endSearch).toHaveBeenCalledWith("terminal-1");
    expect(screen.queryByTestId("terminal-search-bar")).toBeNull();
  });

  it("activates the terminal panel before opening a native context menu", async () => {
    let emitContextMenuRequest: (req: {
      panelId: string;
      x: number;
      y: number;
    }) => void = () => {
      throw new Error("context menu listener was not registered");
    };
    vi.mocked(window.pier.terminal.onContextMenuRequest).mockImplementation(
      (cb) => {
        emitContextMenuRequest = cb;
        return vi.fn();
      }
    );
    const props = createPanelProps();

    render(<TerminalPanel {...props} />);

    emitContextMenuRequest({ panelId: "terminal-1", x: 12, y: 24 });

    await waitFor(() => {
      expect(popupContextMenuAtMock).toHaveBeenCalledWith(
        "terminal/content",
        {
          x: 12,
          y: 24,
        },
        {
          sourcePanelComponent: "terminal",
          sourcePanelContext: props.params.context,
          sourcePanelGroupId: "group-terminal-1",
          sourcePanelId: "terminal-1",
        }
      );
    });
    expect(props.api.setActive).toHaveBeenCalledOnce();
    expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
      "dockview-active-panel"
    );
  });

  // M4 前, composer 默认 enabled=true 就会挂载 (无需 agent 活动), 这三个用例
  // 因此显式关掉开关避免 ResizeObserver.observe / 挂载即聚焦的副作用干扰计数
  // 断言。M4 后挂载门还要求本面板前台活动是 agent, 本文件其余用例默认不注入
  // 活动, composer 本就不挂载 —— 这里不再需要关开关, 只留一句存档说明。
  describe("without an injected agent activity (composer mount gate stays closed)", () => {
    it("does not create a hidden inactive native terminal only because its anchor is renderable", async () => {
      const props = createPanelProps({ isActive: false, isVisible: false });

      render(<TerminalPanel {...props} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(window.pier.terminal.create).not.toHaveBeenCalled();
      expect(TestResizeObserver.observeCount).toBe(1);
    });

    it("uses dockview dimension events and anchor resize observations for terminal frame updates", async () => {
      const props = createPanelProps();

      render(<TerminalPanel {...props} />);

      await waitFor(() => {
        expect(window.pier.terminal.create).toHaveBeenCalledWith(
          expect.objectContaining({ panelId: "terminal-1" })
        );
      });
      await waitFor(() => {
        expect(TestResizeObserver.observeCount).toBe(1);
      });
      requestTerminalPresentationMock.mockClear();

      props.emitDimensions({ height: 340, width: 460 });

      anchorFrame = {
        height: 340,
        width: 460,
        x: 10,
        y: 20,
      };
      TestResizeObserver.instances[0]?.emit();
    });

    it("holds Web keyboard ownership for the whole search lifecycle, not DOM focus", async () => {
      setTerminalBasePanel({
        kind: "terminal",
        panelId: "terminal-1",
      });
      vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
      render(<TerminalPanel {...createPanelProps()} />);
      act(() => {
        window.dispatchEvent(
          new CustomEvent("pier:terminal:open-search", {
            detail: { panelId: "terminal-1" },
          })
        );
      });
      await screen.findByTestId("terminal-search-input");

      // 搜索可见 → 持有一次 web 焦点请求，effective = web，basePanel 不被改写。
      await waitFor(() => {
        expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
          expect.objectContaining({
            basePanel: { kind: "terminal", panelId: "terminal-1" },
            webRequestCount: 1,
          })
        );
      });

      // DOM 焦点移动（栏内或栏外）都不应改变请求计数 —— 不再由 focus/blur 驱动。
      screen.getByRole("button", { name: "Previous match" }).focus();
      expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({ webRequestCount: 1 })
      );

      const outside = document.createElement("button");
      document.body.append(outside);
      try {
        outside.focus();
        // 焦点移到搜索栏外、搜索仍可见 —— 仍持有 web 请求（不回写 terminal）。
        expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
          expect.objectContaining({ webRequestCount: 1 })
        );
      } finally {
        outside.remove();
      }

      // 关闭搜索 → 释放请求，effective 回到 basePanel(terminal-1)。
      fireEvent.keyDown(screen.getByTestId("terminal-search-input"), {
        key: "Escape",
      });
      await waitFor(() => {
        expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
          expect.objectContaining({
            basePanel: { kind: "terminal", panelId: "terminal-1" },
            webRequestCount: 0,
          })
        );
      });
    });
  });

  describe("composer integration (mount gate + pixel formula)", () => {
    const openComposer = (panelId = "terminal-1") => {
      window.dispatchEvent(
        new CustomEvent("pier:terminal:open-composer", {
          detail: { panelId },
        })
      );
    };

    it("does not mount the composer for agent activity alone until opened", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });

      render(<TerminalPanel {...createPanelProps()} />);

      await waitFor(() => {
        expect(window.pier.terminal.create).toHaveBeenCalledWith(
          expect.objectContaining({ panelId: "terminal-1" })
        );
      });
      expect(screen.queryByTestId("terminal-composer")).toBeNull();

      act(() => {
        openComposer();
      });

      await waitFor(() => {
        expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
      });
    });

    it("toggles the composer closed when open-composer fires again", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });

      render(<TerminalPanel {...createPanelProps()} />);

      act(() => {
        openComposer();
      });
      await waitFor(() => {
        expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
      });

      act(() => {
        openComposer();
      });
      await waitFor(() => {
        expect(screen.queryByTestId("terminal-composer")).toBeNull();
      });
    });

    it("does not mount the composer when opened without an agent activity", async () => {
      render(<TerminalPanel {...createPanelProps()} />);

      await waitFor(() => {
        expect(window.pier.terminal.create).toHaveBeenCalledWith(
          expect.objectContaining({ panelId: "terminal-1" })
        );
      });

      act(() => {
        openComposer();
      });

      expect(screen.queryByTestId("terminal-composer")).toBeNull();
    });

    it("does not mount the composer when opened on a shell activity", async () => {
      useForegroundActivityStore.setState({
        activities: {
          "terminal-1": {
            kind: "shell",
            panelId: "terminal-1",
            spawnedAt: 1,
            updatedAt: 1,
            windowId: "test-window",
          },
        },
        ts: 1,
      });

      render(<TerminalPanel {...createPanelProps()} />);

      await waitFor(() => {
        expect(window.pier.terminal.create).toHaveBeenCalledWith(
          expect.objectContaining({ panelId: "terminal-1" })
        );
      });

      act(() => {
        openComposer();
      });

      expect(screen.queryByTestId("terminal-composer")).toBeNull();
    });

    it("returns terminal keyboard focus when the agent activity ends while the panel is active", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });
      const props = createPanelProps({ isActive: true });

      render(<TerminalPanel {...props} />);

      act(() => {
        openComposer();
      });

      await waitFor(() => {
        expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
      });
      // 原生聚焦开关：composer 挂载即声明该面板禁止原生聚焦。
      await waitFor(() => {
        expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
          expect.objectContaining({
            focusDisabledPanelIds: ["terminal-1"],
          })
        );
      });
      vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

      act(() => {
        useForegroundActivityStore.setState({ activities: {}, ts: 2 });
      });

      await waitFor(() => {
        expect(screen.queryByTestId("terminal-composer")).toBeNull();
      });
      await waitFor(() => {
        expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
          expect.objectContaining({
            basePanel: { kind: "terminal", panelId: "terminal-1" },
            focusDisabledPanelIds: [],
          })
        );
      });
    });

    it("does not steal terminal keyboard focus when the agent activity ends on an inactive panel", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });
      const props = createPanelProps({ isActive: false });

      render(<TerminalPanel {...props} />);

      act(() => {
        openComposer();
      });

      await waitFor(() => {
        expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
      });
      vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

      act(() => {
        useForegroundActivityStore.setState({ activities: {}, ts: 2 });
      });

      await waitFor(() => {
        expect(screen.queryByTestId("terminal-composer")).toBeNull();
      });
      // composer 自身的 overlay 聚焦/让出记账（activateOverlay/deactivateOverlay）
      // 会无关地触发 applyHostSnapshot（basePanel 仍是 web），因此不能断言
      // "完全没被调用"；只断言 basePanel 从未翻向该终端面板。
      expect(window.pier.terminal.applyHostSnapshot).not.toHaveBeenCalledWith(
        expect.objectContaining({
          basePanel: { kind: "terminal", panelId: "terminal-1" },
        })
      );
    });

    it("does not mount the composer for a restored (exited) agent session even when opened", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });
      vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
        agent: {
          agentId: "claude",
          exitCode: 0,
          finishedAt: 1_772_000_001_000,
          launch: {
            agentId: "claude",
            command: "claude --dangerously-skip-permissions",
            cwd: "/Users/xyz/ABC/pier",
          },
          startedAt: 1_772_000_000_000,
          status: "exited",
        },
        context,
        tab: { icon: { id: "agent:claude" }, title: "Claude" },
        title: "Claude",
        updatedAt: "2026-07-06T00:00:00.000Z",
      } as TerminalPanelSessionSnapshot);

      render(<TerminalPanel {...createPanelProps({ params: { context } })} />);

      await screen.findByTestId("terminal-agent-result");

      act(() => {
        openComposer();
      });

      expect(screen.queryByTestId("terminal-composer")).toBeNull();
    });

    it("does not mount the composer for a restored (completed) task session even when opened", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });
      vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
        context,
        tab: completedTaskTab,
        task: { ...taskMetadata, exitCode: 0, status: "succeeded" },
        title: "test",
        updatedAt: "2026-06-25T00:00:00.000Z",
      });

      render(
        <TerminalPanel
          {...createPanelProps({
            params: {
              context,
              launchId: "launch-1",
              tab: taskTab,
              task: taskMetadata,
            },
          })}
        />
      );

      await screen.findByTestId("terminal-task-result");

      act(() => {
        openComposer();
      });

      expect(screen.queryByTestId("terminal-composer")).toBeNull();
    });

    it("derives --terminal-content-bottom from the composer's measured height", async () => {
      useForegroundActivityStore.setState({
        activities: { "terminal-1": agentActivityFor("terminal-1") },
        ts: 1,
      });
      const composerHeightPx = 96;
      const isComposerRoot = (element: HTMLElement) =>
        element.firstElementChild?.getAttribute("data-testid") ===
        "terminal-composer";
      const previousGetBoundingClientRect =
        HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (isComposerRoot(this)) {
          return {
            bottom: composerHeightPx,
            height: composerHeightPx,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0,
            toJSON: () => null,
          } as DOMRect;
        }
        return previousGetBoundingClientRect.call(this);
      };

      const { container } = render(<TerminalPanel {...createPanelProps()} />);

      act(() => {
        openComposer();
      });

      const contentBottom = () =>
        (
          container.querySelector(
            '[data-testid="terminal-panel-root"]'
          ) as HTMLElement | null
        )?.style.getPropertyValue("--terminal-content-bottom");

      await waitFor(() => {
        expect(contentBottom()).toBe(
          `${24 + composerHeightPx + TERMINAL_COMPOSER_GAP_PX * 2}px`
        );
      });
    });
  });
});
