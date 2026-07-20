import type { TerminalFocusRequest } from "@shared/contracts/terminal.ts";
import { act, render, screen } from "@testing-library/react";
import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { installWorkspaceRendererCommandListener } from "@/components/workspace/workspace-renderer-command-listener.ts";
import {
  confirmTerminalLaunch,
  resetTerminalLaunchConfirmationsForTest,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
import { flushWorkspaceLayout } from "@/lib/workspace/workspace-layout-persistence.ts";
import {
  flushTerminalLayoutFramesTrailing,
  readRegisteredTerminalAnchorFrame,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { resetTerminalPresentationReconcilerForTests } from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import {
  resetTerminalOverlayFocusForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  registerTerminalComposerTakeover,
  resetTerminalComposerTakeoverForTests,
} from "@/stores/terminal-composer-takeover.ts";
import {
  requestTerminalFocusIntent,
  requestTerminalWebFocus,
  resetTerminalInputRoutingForTests,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";
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
  let parametersChange: ((params: Record<string, unknown>) => void) | null =
    null;
  return {
    api: {
      isActive: opts.isActive ?? false,
      isVisible: opts.isVisible ?? false,
      onDidParametersChange: vi.fn(
        (listener: (params: Record<string, unknown>) => void) => {
          parametersChange = listener;
          return { dispose: vi.fn() };
        }
      ),
      setActive: vi.fn(),
    },
    emitParametersChange: (params: Record<string, unknown>) => {
      parametersChange?.(params);
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
  projectRootPath: "/Users/xyz/ABC/pier",
  source: "command" as const,
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
};

function installPierWindowApi() {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      rendererCommand: {
        onCommand: vi.fn(() => vi.fn()),
        resolve: vi.fn(),
      },
      window: {
        getContext: vi.fn(async () => ({
          mode: "restore",
          recordId: "record-current",
          windowId: "main",
        })),
        readyToShow: vi.fn(),
      },
      terminal: {
        applyHostSnapshot: vi.fn(),
        onFocusRequest: vi.fn(() => vi.fn()),
        reconcile: vi.fn(),
      },
      workspace: {
        clearLayout: vi.fn(async () => undefined),
        loadLayout: vi.fn(async () => null),
        onNewTerminalRequest: vi.fn(() => vi.fn()),
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
    | ((change: {
        origin: "api" | "user";
        panel: ReturnType<typeof createPanel> | null;
      }) => void)
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
      (
        cb: (change: {
          origin: "api" | "user";
          panel: ReturnType<typeof createPanel> | null;
        }) => void
      ) => {
        activePanelChange = cb;
        return { dispose: vi.fn() };
      }
    ),
    onDidAddPanel: vi.fn(() => ({ dispose: vi.fn() })),
    onDidLayoutChange: vi.fn((cb: () => void) => {
      layoutChange = cb;
      return { dispose: vi.fn() };
    }),
    onDidMaximizedGroupChange: vi.fn((cb: () => void) => {
      maximizedGroupChange = cb;
      return { dispose: vi.fn() };
    }),
    onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
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
      activePanelChange({ origin: "api", panel });
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

function waitMs(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe("WorkspaceHost", () => {
  beforeEach(() => {
    resetTerminalPresentationReconcilerForTests();
    resetTerminalLaunchConfirmationsForTest();
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
    resetTerminalComposerTakeoverForTests();
    resetTerminalInputRoutingForTests();
    resetTerminalOverlayFocusForTests();
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

  it("marks lifecycle readiness only after dockview layout restoration", async () => {
    const dockview = createDockviewApi([], null);
    render(<WorkspaceHost />);
    expect(screen.getByTestId("workspace-host-root")).toHaveAttribute(
      "data-workspace-ready",
      "false"
    );
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];

    await act(async () => {
      props?.onReady?.({ api: dockview.api });
      await Promise.resolve();
      await waitMs(0);
    });

    expect(screen.getByTestId("workspace-host-root")).toHaveAttribute(
      "data-workspace-ready",
      "true"
    );
  });

  it("wraps web panel components in a hidden Activity boundary when their dockview panel is hidden", async () => {
    const activeTerminal = createPanel({
      component: "terminal",
      id: "terminal-1",
      isActive: true,
      isVisible: true,
    });
    const hiddenWelcome = createPanel({
      component: "welcome",
      id: "welcome-hidden",
      isVisible: false,
    });
    const dockview = createDockviewApi(
      [activeTerminal, hiddenWelcome],
      activeTerminal
    );
    vi.mocked(dockview.api.hasMaximizedGroup).mockReturnValue(false);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    await act(async () => {
      props?.onReady?.({ api: dockview.api });
      dockview.emitLayoutChange();
      await Promise.resolve();
    });

    const WrappedWelcome = props?.components?.welcome;
    if (!WrappedWelcome) {
      throw new Error("welcome component missing");
    }

    let visible = false;
    let visibilityListener: (() => void) | undefined;
    const hiddenWelcomeProps = {
      api: {
        get isVisible() {
          return visible;
        },
        id: "welcome-hidden",
        onDidVisibilityChange: (listener: () => void) => {
          visibilityListener = listener;
          return { dispose: vi.fn() };
        },
        setTitle: vi.fn(),
      },
    } as unknown as ComponentProps<typeof WrappedWelcome>;

    render(<WrappedWelcome {...hiddenWelcomeProps} />);

    expect(await screen.findByText("Pier")).not.toBeVisible();
    act(() => {
      visible = true;
      visibilityListener?.();
    });
    expect(screen.getByText("Pier")).toBeVisible();
  });

  it("does not wrap terminal panel components in a React Activity boundary", () => {
    render(<WorkspaceHost />);

    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    expect(props?.components?.terminal?.name).toBe("TerminalPanel");
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

  it("publishes a newly active terminal through the unified host snapshot", () => {
    const web = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-2",
      isVisible: true,
    });
    const dockview = createDockviewApi([web, terminal], web);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 100,
      width: 200,
      x: 0,
      y: 0,
    });
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

    web.api.isActive = false;
    terminal.api.isActive = true;
    dockview.emitActivePanelChange(terminal);

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "terminal-2",
        activeTerminalPanelId: "terminal-2",
        basePanel: { kind: "terminal", panelId: "terminal-2" },
      })
    );
  });

  it("redirects a newly active terminal panel's focus to an agent composer takeover instead of the native terminal", () => {
    resetTerminalInputRoutingForTests();
    const web = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-2",
      isVisible: true,
    });
    const dockview = createDockviewApi([web, terminal], web);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 100,
      width: 200,
      x: 0,
      y: 0,
    });
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    // 建立已知基线（basePanel=web）：inputFacts 若从未初始化，reconciler 会
    // 从 activeTerminalPanelId 兜底合成 basePanel，干扰下面的断言。
    // setTerminalBasePanel 对相同 target 是 no-op，先用 requestTerminalFocusIntent
    // 换一个不同的 target 强制写一次，再切回 web。
    requestTerminalFocusIntent("seed-panel");
    setTerminalBasePanel({ kind: "web" });
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    const takeoverFocus = vi.fn(() => true);
    registerTerminalComposerTakeover("terminal-2", takeoverFocus);

    web.api.isActive = false;
    terminal.api.isActive = true;
    dockview.emitActivePanelChange(terminal);

    expect(takeoverFocus).toHaveBeenCalledOnce();
    // takeover 命中时也把 basePanel 翻向该终端面板：宿主需要 anchor panel 才能
    // 定位「哪个终端要藏 hardware cursor」（web 浮层占用键盘期间）。
    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "terminal-2",
        activeTerminalPanelId: "terminal-2",
        basePanel: { kind: "terminal", panelId: "terminal-2" },
      })
    );
  });

  it("falls back to requestTerminalFocusIntent when the registered takeover fails to focus (e.g. composer disabled)", () => {
    resetTerminalInputRoutingForTests();
    const web = createPanel({
      component: "welcome",
      id: "welcome-1",
      isActive: true,
      isVisible: true,
    });
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-2",
      isVisible: true,
    });
    const dockview = createDockviewApi([web, terminal], web);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 100,
      width: 200,
      x: 0,
      y: 0,
    });
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    requestTerminalFocusIntent("seed-panel");
    setTerminalBasePanel({ kind: "web" });
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    const takeoverFocus = vi.fn(() => false);
    registerTerminalComposerTakeover("terminal-2", takeoverFocus);

    web.api.isActive = false;
    terminal.api.isActive = true;
    dockview.emitActivePanelChange(terminal);

    expect(takeoverFocus).toHaveBeenCalledOnce();
    // 接管失败：requestTerminalFocusIntent 走原生路径，basePanel 翻向该终端面板。
    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "terminal-2",
        activeTerminalPanelId: "terminal-2",
        basePanel: { kind: "terminal", panelId: "terminal-2" },
      })
    );
  });

  it("publishes Dockview's terminal successor after the active terminal closes", () => {
    const successor = createPanel({
      component: "terminal",
      id: "terminal-1",
      isVisible: true,
    });
    const closing = createPanel({
      component: "terminal",
      id: "terminal-2",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([successor, closing], closing);
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    requestTerminalWebFocus("pier.click");
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

    closing.api.isActive = false;
    successor.api.isActive = true;
    dockview.emitActivePanelChange(successor);

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "terminal-1",
        activeTerminalPanelId: "terminal-1",
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        webRequestCount: 0,
      })
    );
  });

  it("publishes Web ownership when Dockview selects a Web successor", () => {
    const closing = createPanel({
      component: "terminal",
      id: "terminal-1",
      isActive: true,
      isVisible: true,
    });
    const successor = createPanel({
      component: "welcome",
      id: "welcome-1",
      isVisible: true,
    });
    const dockview = createDockviewApi([closing, successor], closing);
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

    closing.api.isActive = false;
    successor.api.isActive = true;
    dockview.emitActivePanelChange(successor);

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePanelId: "welcome-1",
        activeTerminalPanelId: null,
        basePanel: { kind: "web" },
      })
    );
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
    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
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
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

    terminal.api.isActive = false;
    terminal.api.isVisible = false;
    web.api.isActive = true;
    dockview.emitActivePanelChange(web);

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
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

    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 93,
      width: 213,
      x: 0,
      y: 72,
    });

    dockview.emitMaximizedGroupChange();

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTerminalPanelId: "terminal-1",
        terminals: [
          expect.objectContaining({
            panelId: "terminal-1",
            visible: true,
          }),
        ],
      })
    );
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

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
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
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();

    dockview.emitLayoutChange();

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        terminals: [
          expect.objectContaining({
            panelId: "terminal-visible",
            visible: true,
          }),
        ],
      })
    );
  });

  it("does not show hidden inactive terminal panels only because their anchors are visible", () => {
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

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        terminals: [
          expect.objectContaining({
            panelId: "terminal-stale",
            visible: false,
          }),
        ],
      })
    );
  });

  it("keeps the active terminal visible when dockview visibility lags behind its anchor", () => {
    const staleActiveTerminal = createPanel({
      component: "terminal",
      id: "terminal-stale-active",
      isActive: true,
      isVisible: false,
    });
    const dockview = createDockviewApi(
      [staleActiveTerminal],
      staleActiveTerminal
    );
    vi.mocked(dockview.api.hasMaximizedGroup).mockReturnValue(false);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 93,
      width: 213,
      x: 0,
      y: 72,
    });

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    dockview.emitLayoutChange();

    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        activePanelId: "terminal-stale-active",
        activeTerminalPanelId: "terminal-stale-active",
        terminals: [
          expect.objectContaining({
            panelId: "terminal-stale-active",
            visible: true,
          }),
        ],
      })
    );
  });

  it("creates a terminal panel with launchId when main sends terminal.open", async () => {
    const bridge: {
      listener?: Parameters<typeof window.pier.rendererCommand.onCommand>[0];
    } = {};
    const addPanel = vi.fn();
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        window: {
          getContext: vi.fn(() => new Promise<never>(() => undefined)),
          readyToShow: vi.fn(),
        },
        rendererCommand: {
          onCommand: vi.fn((cb) => {
            bridge.listener = cb;
            return vi.fn();
          }),
          resolve,
        },
        terminal: {
          applyHostSnapshot: vi.fn(),
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

    const disposeRendererCommands = installWorkspaceRendererCommandListener();
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
      onDidAddPanel: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      onDidRemovePanel: vi.fn(),
      panels: [],
      toJSON: vi.fn(() => ({ grid: { root: undefined } })),
      totalPanels: 0,
    } as unknown as DockviewReadyEvent["api"];

    act(() => {
      props.onReady?.({ api } as DockviewReadyEvent);
      bridge.listener?.({
        command: {
          context,
          initialInput: "修复终端焦点问题\r",
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
    expect(addPanel.mock.calls[0]?.[0]?.params).not.toHaveProperty(
      "initialInput"
    );
    const panelId = addPanel.mock.calls[0]?.[0]?.id;
    expect(resolve).not.toHaveBeenCalled();
    await act(async () => {
      confirmTerminalLaunch("launch-1");
      await Promise.resolve();
    });
    expect(resolve).toHaveBeenCalledWith({
      data: {
        context,
        panelId,
      },
      ok: true,
      requestId: "req-terminal-open",
    });
    disposeRendererCommands();
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
        window: {
          getContext: vi.fn(() => new Promise<never>(() => undefined)),
          readyToShow: vi.fn(),
        },
        rendererCommand: {
          onCommand: vi.fn(() => vi.fn()),
          resolve: vi.fn(),
        },
        terminal: {
          applyHostSnapshot: vi.fn(),
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
      onDidAddPanel: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      onDidRemovePanel: vi.fn(),
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

  it("flushes the pending debounced layout save on beforeunload", async () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-flush",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    // 等 getContext resolve (flushRecordId 经 .then 缓存) 且 restore 流程结束
    // (isApplyingPersistedLayout 已放开), 之后的 layout change 才算 user touched。
    await waitMs(0);

    dockview.emitLayoutChange();
    expect(window.pier.workspace.saveLayout).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("beforeunload"));

    expect(window.pier.workspace.saveLayout).toHaveBeenCalledTimes(1);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledWith(
      { panels: ["terminal-flush"] },
      "record-current"
    );

    // flush 必须 clearTimeout — 等过 SAVE_DEBOUNCE_MS 不得出现第二次 save。
    await waitMs(600);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledTimes(1);
  });

  it("does not save again on beforeunload after the debounced save already fired", async () => {
    window.dispatchEvent(new Event("beforeunload"));
    await waitMs(0);
    vi.mocked(window.pier.workspace.saveLayout).mockClear();

    const terminal = createPanel({
      component: "terminal",
      id: "terminal-settled",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    await waitMs(0);

    dockview.emitLayoutChange();
    // 等 debounce 正常落盘 — 此时 saveTimer 已自然清空。
    await waitMs(600);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledTimes(1);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledWith(
      { panels: ["terminal-settled"] },
      "record-current"
    );
    vi.mocked(window.pier.workspace.saveLayout).mockClear();

    window.dispatchEvent(new Event("beforeunload"));

    expect(window.pier.workspace.saveLayout).not.toHaveBeenCalled();
  });

  it("persists panel parameter changes through the workspace layout", async () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-params",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    await waitMs(0);
    vi.mocked(window.pier.workspace.saveLayout).mockClear();

    terminal.emitParametersChange({
      floatingLayout: {
        positions: { "runtime-controls": { x: 0.75, y: 0.25 } },
        version: 1,
      },
    });
    await waitMs(600);

    expect(window.pier.workspace.saveLayout).toHaveBeenCalledWith(
      { panels: ["terminal-params"] },
      "record-current"
    );
  });

  it("settles a pending parameter save at the explicit layout flush barrier", async () => {
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-explicit-flush",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    await waitMs(0);
    vi.mocked(window.pier.workspace.saveLayout).mockClear();

    terminal.emitParametersChange({ pinned: true });
    expect(window.pier.workspace.saveLayout).not.toHaveBeenCalled();

    await flushWorkspaceLayout();
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledTimes(1);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledWith(
      { panels: ["terminal-explicit-flush"] },
      "record-current"
    );

    await waitMs(600);
    expect(window.pier.workspace.saveLayout).toHaveBeenCalledTimes(1);
  });

  it("redirects a terminal focus request to an agent composer takeover instead of yielding to the native terminal", () => {
    resetTerminalInputRoutingForTests();
    let focusRequestListener: ((req: TerminalFocusRequest) => void) | undefined;
    vi.mocked(window.pier.terminal.onFocusRequest).mockImplementation((cb) => {
      focusRequestListener = cb;
      return vi.fn();
    });
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-3",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 100,
      width: 200,
      x: 0,
      y: 0,
    });
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    // 建立已知基线（basePanel=web），理由同上。
    requestTerminalFocusIntent("seed-panel");
    setTerminalBasePanel({ kind: "web" });
    useTerminalStore.getState().activateOverlay("test-overlay");
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    const takeoverFocus = vi.fn(() => true);
    registerTerminalComposerTakeover("terminal-3", takeoverFocus);

    focusRequestListener?.({ panelId: "terminal-3", reason: "mouse-down" });

    expect(takeoverFocus).toHaveBeenCalledOnce();
    // yieldToTerminal 被跳过：共存浮层的 overlay 焦点没被清空。
    expect(useTerminalStore.getState().activeOverlayId).toBe("test-overlay");
    // requestTerminalFocusIntent 被跳过：basePanel 没有翻向该终端面板。
    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ basePanel: { kind: "web" } })
    );
  });

  it("falls back to yieldToTerminal + requestTerminalFocusIntent when the registered takeover fails to focus (e.g. composer disabled)", () => {
    resetTerminalInputRoutingForTests();
    let focusRequestListener: ((req: TerminalFocusRequest) => void) | undefined;
    vi.mocked(window.pier.terminal.onFocusRequest).mockImplementation((cb) => {
      focusRequestListener = cb;
      return vi.fn();
    });
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-3",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);
    vi.mocked(readRegisteredTerminalAnchorFrame).mockReturnValue({
      height: 100,
      width: 200,
      x: 0,
      y: 0,
    });
    render(<WorkspaceHost />);
    vi.mocked(DockviewReact).mock.lastCall?.[0]?.onReady?.({
      api: dockview.api,
    });
    // 建立已知基线（basePanel=web），理由同上。
    requestTerminalFocusIntent("seed-panel");
    setTerminalBasePanel({ kind: "web" });
    useTerminalStore.getState().activateOverlay("test-overlay");
    vi.mocked(window.pier.terminal.applyHostSnapshot).mockClear();
    const takeoverFocus = vi.fn(() => false);
    registerTerminalComposerTakeover("terminal-3", takeoverFocus);

    focusRequestListener?.({ panelId: "terminal-3", reason: "mouse-down" });

    expect(takeoverFocus).toHaveBeenCalledOnce();
    // 接管失败：yieldToTerminal 生效，共存浮层的 overlay 焦点被清空。
    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
    // 接管失败：requestTerminalFocusIntent 走原生路径，basePanel 翻向该终端面板。
    expect(window.pier.terminal.applyHostSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        basePanel: { kind: "terminal", panelId: "terminal-3" },
      })
    );
  });

  it("disposes pending layout and IPC subscriptions on unmount", async () => {
    const focusDispose = vi.fn();
    const newTerminalDispose = vi.fn();
    vi.mocked(window.pier.terminal.onFocusRequest).mockReturnValue(
      focusDispose
    );
    vi.mocked(window.pier.workspace.onNewTerminalRequest).mockReturnValue(
      newTerminalDispose
    );
    const terminal = createPanel({
      component: "terminal",
      id: "terminal-unmount",
      isActive: true,
      isVisible: true,
    });
    const dockview = createDockviewApi([terminal], terminal);

    const { unmount } = render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.lastCall?.[0];
    props?.onReady?.({ api: dockview.api });
    await waitMs(0);
    vi.mocked(window.pier.workspace.saveLayout).mockClear();

    terminal.emitParametersChange({ pinned: true });
    unmount();

    expect(focusDispose).toHaveBeenCalledOnce();
    expect(newTerminalDispose).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState()).toMatchObject({
      api: null,
      hasMaximizedGroup: false,
    });
    window.dispatchEvent(new Event("beforeunload"));
    await waitMs(600);
    expect(window.pier.workspace.saveLayout).not.toHaveBeenCalled();
  });
});
