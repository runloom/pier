import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
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
import { hasRegisteredTerminalAnchor } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useFontStore } from "@/stores/font.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import {
  resetTerminalOverlayFocusForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

interface TerminalRelaunchRequest {
  context?: PanelContext | undefined;
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
      launchId?: string;
      tab?: PanelTabChrome;
      task?: TaskPanelMetadata;
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
    terminalRelaunchStoreMock.reset();

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
    useZoomStore.setState({ windowZoomLevel: 0 });
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
        terminal: {
          applyInputRouting: vi.fn(),
          applyPresentation: vi.fn(),
          close: vi.fn(),
          create: vi.fn(async () => ({ ok: true })),
          endSearch: vi.fn(async () => ({ ok: true })),
          hide: vi.fn(),
          navigateSearch: vi.fn(async () => ({ ok: true })),
          onContextMenuRequest: vi.fn(() => vi.fn()),
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
          setFrame: vi.fn(),
          show: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    terminalStatusItemRegistry.clearForTests();
    resetTerminalInputRoutingForTests();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
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

  it("creates a native terminal when its anchor is renderable even if dockview visibility is stale", async () => {
    const props = createPanelProps({ isActive: false, isVisible: false });

    render(<TerminalPanel {...props} />);

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
    ).toContain("bottom-6");
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
    ).toContain("bottom-6");
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
    ).toContain("bottom-6");
  });

  it("passes launchId into native terminal creation", async () => {
    render(
      <TerminalPanel
        {...createPanelProps({
          params: { context, launchId: "launch-1" },
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
    expect(result).not.toHaveClass("p-4", "text-sm");
    expect(result).toHaveStyle({ fontSize: "13px" });
    expect(result).toHaveTextContent("[pier] restored task");
    expect(result).toHaveTextContent("Tasktest");
    expect(result).toHaveTextContent("Statussucceeded");
    expect(result).toHaveTextContent("Commandpnpm run test");
    expect(window.pier.terminal.create).not.toHaveBeenCalled();
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
    vi.mocked(window.pier.terminal.setFrame).mockClear();
    requestTerminalPresentationMock.mockClear();

    props.emitDimensions({ height: 340, width: 460 });

    expect(window.pier.terminal.setFrame).not.toHaveBeenCalled();
    vi.mocked(window.pier.terminal.setFrame).mockClear();
    anchorFrame = {
      height: 340,
      width: 460,
      x: 10,
      y: 20,
    };
    TestResizeObserver.instances[0]?.emit();

    expect(window.pier.terminal.setFrame).not.toHaveBeenCalled();
  });

  it("sends a trailing native frame after window layout pulses settle", async () => {
    render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.setFrame).mockClear();

    emitWindowLayoutPulse?.({ reason: "view-zoom" });
    anchorFrame = {
      height: 620,
      width: 900,
      x: 10,
      y: 20,
    };

    expect(window.pier.terminal.setFrame).not.toHaveBeenCalled();
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
    vi.mocked(window.pier.terminal.show).mockClear();
    requestTerminalPresentationMock.mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
        "visibility"
      );
    });
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
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
    vi.mocked(window.pier.terminal.show).mockClear();
    requestTerminalPresentationMock.mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
        "visibility"
      );
    });
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
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

  it("holds Web keyboard ownership for the whole search lifecycle, not DOM focus", async () => {
    setTerminalBasePanel({
      kind: "terminal",
      panelId: "terminal-1",
    });
    vi.mocked(window.pier.terminal.applyInputRouting).mockClear();
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
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
        expect.objectContaining({
          basePanel: { kind: "terminal", panelId: "terminal-1" },
          webRequestCount: 1,
        })
      );
    });

    // DOM 焦点移动（栏内或栏外）都不应改变请求计数 —— 不再由 focus/blur 驱动。
    screen.getByRole("button", { name: "Previous match" }).focus();
    expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
      expect.objectContaining({ webRequestCount: 1 })
    );

    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      outside.focus();
      // 焦点移到搜索栏外、搜索仍可见 —— 仍持有 web 请求（不回写 terminal）。
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
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
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
        expect.objectContaining({
          basePanel: { kind: "terminal", panelId: "terminal-1" },
          webRequestCount: 0,
        })
      );
    });
  });

  it("yields keyboard to the terminal on focus intent while the search bar stays mounted", async () => {
    setTerminalBasePanel({
      kind: "terminal",
      panelId: "terminal-1",
    });
    vi.mocked(window.pier.terminal.applyInputRouting).mockClear();
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
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
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
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
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
      expect(window.pier.terminal.applyInputRouting).toHaveBeenLastCalledWith(
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
      expect(popupContextMenuAtMock).toHaveBeenCalledWith("terminal/content", {
        x: 12,
        y: 24,
      });
    });
    expect(props.api.setActive).toHaveBeenCalledOnce();
    expect(requestTerminalPresentationMock).toHaveBeenCalledWith(
      "dockview-active-panel"
    );
  });
});
