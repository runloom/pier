import { act, render, screen } from "@testing-library/react";
import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import {
  flushTerminalLayoutFramesTrailing,
  readRegisteredTerminalAnchorFrame,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { resetTerminalPresentationReconcilerForTests } from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: vi.fn((props) => (
      <div
        data-disable-tabs-overflow-list={String(props.disableTabsOverflowList)}
        data-left-header-actions={
          props.leftHeaderActionsComponent?.name ?? "none"
        }
        data-right-header-actions={
          props.rightHeaderActionsComponent?.name ?? "none"
        }
        data-testid="dockview"
      />
    )),
  };
});

vi.mock("@pier/ui/tooltip.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pier/ui/tooltip.tsx")>();
  return {
    ...actual,
    TooltipProvider: ({
      children,
      skipDelayDuration,
    }: {
      children: ReactNode;
      skipDelayDuration?: number;
    }) => (
      <div
        data-skip-delay-duration={skipDelayDuration}
        data-testid="workspace-tooltip-provider"
      >
        {children}
      </div>
    ),
  };
});

vi.mock(
  "@/panel-kits/terminal/terminal-layout-coordinator.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/panel-kits/terminal/terminal-layout-coordinator.ts")
      >();
    return {
      ...actual,
      flushTerminalLayoutFramesTrailing: vi.fn(),
      readRegisteredTerminalAnchorFrame: vi.fn(() => null),
    };
  }
);

function createPanel(opts: {
  component: "terminal" | "welcome";
  id: string;
  isActive?: boolean;
  isVisible?: boolean;
}) {
  return {
    api: {
      isActive: opts.isActive ?? false,
      isVisible: opts.isVisible ?? false,
      setActive: vi.fn(),
    },
    id: opts.id,
    title: opts.component === "terminal" ? "Terminal" : "Welcome",
    view: { contentComponent: opts.component },
  };
}

const context = {
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "command" as const,
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
};

function installPierWindowApi() {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      getWindowContext: vi.fn(async () => ({
        mode: "restore",
        recordId: "record-current",
        sessionId: "record-current",
        windowId: "main",
      })),
      readyToShow: vi.fn(),
      rendererCommand: {
        onCommand: vi.fn(),
        resolve: vi.fn(),
      },
      terminal: {
        applyInputRouting: vi.fn(),
        applyPresentation: vi.fn(),
        hide: vi.fn(),
        onFocusRequest: vi.fn(),
        reconcile: vi.fn(),
        show: vi.fn(),
      },
      workspace: {
        clearLayout: vi.fn(async () => undefined),
        loadLayout: vi.fn(async () => null),
        saveLayout: vi.fn(async () => undefined),
      },
    },
  });
}

function createDockviewApi(
  panels: ReturnType<typeof createPanel>[],
  activePanel: ReturnType<typeof createPanel> | null
) {
  let activePanelChange:
    | ((panel: ReturnType<typeof createPanel> | null) => void)
    | null = null;
  let layoutChange: (() => void) | null = null;
  let currentActivePanel = activePanel;
  let maximizedGroupChange: (() => void) | null = null;
  const api = {
    get activePanel() {
      return currentActivePanel;
    },
    addPanel: vi.fn(),
    fromJSON: vi.fn(),
    hasMaximizedGroup: vi.fn(() => true),
    onDidActivePanelChange: vi.fn(
      (cb: (panel: ReturnType<typeof createPanel> | null) => void) => {
        activePanelChange = cb;
        return { dispose: vi.fn() };
      }
    ),
    onDidLayoutChange: vi.fn((cb: () => void) => {
      layoutChange = cb;
      return { dispose: vi.fn() };
    }),
    onDidMaximizedGroupChange: vi.fn((cb: () => void) => {
      maximizedGroupChange = cb;
      return { dispose: vi.fn() };
    }),
    panels,
    toJSON: vi.fn(() => ({ panels: panels.map((panel) => panel.id) })),
    totalPanels: panels.length,
  } as unknown as DockviewReadyEvent["api"];

  return {
    api,
    emitActivePanelChange: (panel: ReturnType<typeof createPanel> | null) => {
      if (!activePanelChange) {
        throw new Error("onDidActivePanelChange was not registered");
      }
      currentActivePanel = panel;
      activePanelChange(panel);
    },
    emitMaximizedGroupChange: () => {
      if (!maximizedGroupChange) {
        throw new Error("onDidMaximizedGroupChange was not registered");
      }
      maximizedGroupChange();
    },
    emitLayoutChange: () => {
      if (!layoutChange) {
        throw new Error("onDidLayoutChange was not registered");
      }
      layoutChange();
    },
  };
}

describe("WorkspaceHost", () => {
  beforeEach(() => {
    resetTerminalPresentationReconcilerForTests();
    installPierWindowApi();
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue(null);
    useWorkspaceStore.setState({ api: null, hasMaximizedGroup: false });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    Reflect.deleteProperty(window, "pier");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useWorkspaceStore.setState({ api: null, hasMaximizedGroup: false });
  });

  it("disables dockview overflow and uses the workspace shadcn header actions", () => {
    render(<WorkspaceHost />);

    expect(screen.getByTestId("workspace-host-root")).toHaveAttribute(
      "data-dockview-maximized",
      "false"
    );
    expect(screen.getByTestId("workspace-tooltip-provider")).toHaveAttribute(
      "data-skip-delay-duration",
      "0"
    );
    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-disable-tabs-overflow-list",
      "true"
    );
    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-left-header-actions",
      "WorkspaceHeaderActions"
    );
    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-right-header-actions",
      "WorkspaceHeaderRightActions"
    );
    expect(DockviewReact).toHaveBeenCalled();
  });

  it("marks the workspace root while dockview has a maximized group", () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-1",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });

    expect(screen.getByTestId("workspace-host-root")).toHaveAttribute(
      "data-dockview-maximized",
      "false"
    );

    act(() => {
      dockview.emitMaximizedGroupChange();
    });

    expect(screen.getByTestId("workspace-host-root")).toHaveAttribute(
      "data-dockview-maximized",
      "true"
    );
    expect(useWorkspaceStore.getState().hasMaximizedGroup).toBe(true);
  });

  it("hides inactive terminals when a web panel is maximized", () => {
    const activeWeb = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const hiddenTerminal = createPanel({
      component: "terminal",
      id: "terminal-hidden",
      isVisible: false,
    });
    const visibleTerminal = createPanel({
      component: "terminal",
      id: "terminal-visible",
      isVisible: true,
    });
    const dockview = createDockviewApi(
      [activeWeb, hiddenTerminal, visibleTerminal],
      activeWeb
    );

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });

    dockview.emitMaximizedGroupChange();

    expect(flushTerminalLayoutFramesTrailing).toHaveBeenCalledWith(
      "dockview-maximize"
    );
    expect(window.pier.terminal.applyPresentation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "welcome-1",
        activeTerminalPanelId: null,
        reason: "dockview-maximize",
        terminals: [
          expect.objectContaining({
            panelId: "terminal-hidden",
            visible: false,
          }),
          expect.objectContaining({
            panelId: "terminal-visible",
            visible: false,
          }),
        ],
      })
    );
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
  });

  it("resyncs terminal visibility when tabs change while maximized", () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-1",
      isActive: true,
      isVisible: true,
    });
    const web = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: false,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal, web], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    dockview.emitMaximizedGroupChange();
    vi.mocked(window.pier.terminal.hide).mockClear();
    vi.mocked(window.pier.terminal.show).mockClear();
    vi.mocked(window.pier.terminal.applyPresentation).mockClear();

    terminal.api.isActive = false;
    terminal.api.isVisible = false;
    web.api.isActive = true;
    dockview.emitActivePanelChange(web);

    expect(window.pier.terminal.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        activePanelId: "welcome-1",
        activeTerminalPanelId: null,
        terminals: [
          expect.objectContaining({
            panelId: "terminal-1",
            visible: false,
          }),
        ],
      })
    );
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
  });

  it("does not show a maximized active terminal until its renderer anchor is visible", () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-1",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue(null);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    dockview.emitMaximizedGroupChange();

    expect(flushTerminalLayoutFramesTrailing).toHaveBeenCalledWith(
      "dockview-maximize"
    );
    expect(window.pier.terminal.show).not.toHaveBeenCalledWith("terminal-1");

    vi.mocked(window.pier.terminal.hide).mockClear();
    vi.mocked(window.pier.terminal.show).mockClear();
    vi.mocked(window.pier.terminal.applyPresentation).mockClear();
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 93,
      width: 213,
      x: 0,
      y: 72,
    });

    dockview.emitMaximizedGroupChange();

    expect(window.pier.terminal.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTerminalPanelId: "terminal-1",
        terminals: [
          expect.objectContaining({
            focused: false,
            panelId: "terminal-1",
            visible: true,
          }),
        ],
      })
    );
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
  });

  it("keeps visible split terminals shown outside maximized mode", () => {
    const activeWeb = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const visibleTerminal = createPanel({
      component: "terminal",
      id: "terminal-visible",
      isVisible: true,
    });
    const hiddenTerminal = createPanel({
      component: "terminal",
      id: "terminal-hidden",
      isVisible: false,
    });
    const dockview = createDockviewApi(
      [activeWeb, visibleTerminal, hiddenTerminal],
      activeWeb
    );
    vi.mocked(dockview.api.hasMaximizedGroup).mockReturnValue(false);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockImplementation(
      (panelId) =>
        panelId === "terminal-visible"
          ? { height: 93, width: 213, x: 0, y: 72 }
          : null
    );

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    dockview.emitActivePanelChange(activeWeb);

    expect(window.pier.terminal.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTerminalPanelId: null,
        terminals: [
          expect.objectContaining({
            panelId: "terminal-visible",
            visible: true,
          }),
          expect.objectContaining({
            panelId: "terminal-hidden",
            visible: false,
          }),
        ],
      })
    );
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
  });

  it("resyncs terminal visibility on layout changes after leaving maximized mode", () => {
    const activeWeb = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const visibleTerminal = createPanel({
      component: "terminal",
      id: "terminal-visible",
      isVisible: true,
    });
    const dockview = createDockviewApi([activeWeb, visibleTerminal], activeWeb);
    vi.mocked(dockview.api.hasMaximizedGroup).mockReturnValue(false);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockImplementation(
      (panelId) =>
        panelId === "terminal-visible"
          ? { height: 93, width: 213, x: 0, y: 72 }
          : null
    );

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    vi.mocked(window.pier.terminal.applyPresentation).mockClear();

    dockview.emitLayoutChange();

    expect(window.pier.terminal.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        terminals: [
          expect.objectContaining({
            panelId: "terminal-visible",
            visible: true,
          }),
        ],
      })
    );
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
  });

  it("shows terminal panels with visible anchors when dockview visibility is stale", () => {
    const activeWeb = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const staleTerminal = createPanel({
      component: "terminal",
      id: "terminal-stale",
      isVisible: false,
    });
    const dockview = createDockviewApi([activeWeb, staleTerminal], activeWeb);
    vi.mocked(dockview.api.hasMaximizedGroup).mockReturnValue(false);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockImplementation(
      (panelId) =>
        panelId === "terminal-stale"
          ? { height: 93, width: 213, x: 0, y: 72 }
          : null
    );

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    dockview.emitLayoutChange();

    expect(window.pier.terminal.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        terminals: [
          expect.objectContaining({
            panelId: "terminal-stale",
            visible: true,
          }),
        ],
      })
    );
    expect(window.pier.terminal.show).not.toHaveBeenCalled();
    expect(window.pier.terminal.hide).not.toHaveBeenCalled();
  });

  it("creates a terminal panel with launchId when main sends terminal.open", () => {
    const bridge: {
      listener?: Parameters<typeof window.pier.rendererCommand.onCommand>[0];
    } = {};
    const addPanel = vi.fn();
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        getWindowContext: vi.fn(() => new Promise(() => undefined)),
        readyToShow: vi.fn(),
        rendererCommand: {
          onCommand: vi.fn((cb) => {
            bridge.listener = cb;
            return vi.fn();
          }),
          resolve,
        },
        terminal: {
          applyInputRouting: vi.fn(),
          applyPresentation: vi.fn(),
          onFocusRequest: vi.fn(),
          reconcile: vi.fn(),
        },
        workspace: {
          clearLayout: vi.fn(),
          loadLayout: vi.fn(),
          onNewTerminalRequest: vi.fn(),
          saveLayout: vi.fn(),
        },
      } as never,
    });

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.calls.at(-1)?.[0];
    if (!props) {
      throw new Error("DockviewReact props missing");
    }
    const api = {
      activeGroup: null,
      activePanel: null,
      addPanel,
      onDidActivePanelChange: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      panels: [],
      toJSON: vi.fn(() => ({ grid: { root: undefined } })),
      totalPanels: 0,
    } as unknown as DockviewReadyEvent["api"];

    act(() => {
      props.onReady?.({ api } as DockviewReadyEvent);
      bridge.listener?.({
        command: {
          context,
          launchId: "launch-1",
          type: "terminal.open",
        },
        requestId: "req-terminal-open",
      });
    });

    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: {
          context,
          launchId: "launch-1",
        },
      })
    );
    const panelId = addPanel.mock.calls[0]?.[0]?.id;
    expect(resolve).toHaveBeenCalledWith({
      data: {
        context,
        panelId,
      },
      ok: true,
      requestId: "req-terminal-open",
    });
  });

  it("creates a terminal panel when main sends the native menu request", () => {
    const bridge: { listener?: () => void } = {};
    const addPanel = vi.fn();
    const onNewTerminalRequest = vi.fn((cb: () => void) => {
      bridge.listener = cb;
      return vi.fn();
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        getWindowContext: vi.fn(() => new Promise(() => undefined)),
        readyToShow: vi.fn(),
        rendererCommand: {
          onCommand: vi.fn(),
          resolve: vi.fn(),
        },
        terminal: {
          applyInputRouting: vi.fn(),
          onFocusRequest: vi.fn(),
          reconcile: vi.fn(),
        },
        workspace: {
          clearLayout: vi.fn(),
          loadLayout: vi.fn(),
          onNewTerminalRequest,
          saveLayout: vi.fn(),
        },
      } as never,
    });

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.calls.at(-1)?.[0];
    if (!props) {
      throw new Error("DockviewReact props missing");
    }
    const api = {
      activeGroup: null,
      activePanel: null,
      addPanel,
      onDidActivePanelChange: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      panels: [],
      toJSON: vi.fn(() => ({ grid: { root: undefined } })),
      totalPanels: 0,
    } as unknown as DockviewReadyEvent["api"];

    act(() => {
      props.onReady?.({ api } as DockviewReadyEvent);
      bridge.listener?.();
    });

    expect(onNewTerminalRequest).toHaveBeenCalledOnce();
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        title: "Terminal",
      })
    );
  });
});
