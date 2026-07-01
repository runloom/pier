import type { PanelContext } from "@shared/contracts/panel.ts";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));
const TERMINAL_PANEL_ID_PREFIX = /^terminal-/;

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

import {
  requestTerminalRelaunch,
  useTerminalRelaunchRequest,
} from "@/stores/terminal-relaunch.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function webPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Welcome",
    view: { contentComponent: "welcome" },
  };
}

function createApi(
  panels: ReturnType<typeof terminalPanel>[],
  groups = [{ panels }]
) {
  return {
    activeGroup: groups[0] ?? null,
    activePanel: panels[0] ?? null,
    groups,
    addPanel: vi.fn(),
    panels,
    removePanel: vi.fn(),
    totalPanels: panels.length,
  };
}

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
};

function firstInvocationOrder(fn: { mock: { invocationCallOrder: number[] } }) {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error("expected mock to be called");
  }
  return order;
}

describe("workspace terminal close lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    closeCurrentWindowMock.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        closeCurrentWindow: vi.fn(async () => undefined),
        getWindowContext: vi.fn(async () => ({
          mode: "restore",
          recordId: "record-current",
          sessionId: "record-current",
          windowId: "main",
        })),
        workspace: { clearLayout: vi.fn(async () => undefined) },
        terminal: { close: vi.fn() },
      },
    });
    useWorkspaceStore.getState().setApi(null);
  });

  it("closes the native terminal when a terminal panel is explicitly closed", () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });

  it("clears a pending terminal relaunch request when that terminal panel is explicitly closed", () => {
    const panel = terminalPanel("terminal-relaunch-close");
    const api = createApi([panel, webPanel("welcome-1")]);
    const relaunch = renderHook(() => useTerminalRelaunchRequest(panel.id));

    useWorkspaceStore.getState().setApi(api as never);

    act(() => {
      requestTerminalRelaunch({
        launchId: "launch-retry",
        panelId: panel.id,
      });
    });
    expect(relaunch.result.current?.launchId).toBe("launch-retry");

    act(() => {
      useWorkspaceStore.getState().closePanel(panel.id);
    });

    expect(relaunch.result.current).toBeNull();
    expect(window.pier.terminal.close).toHaveBeenCalledWith(panel.id);
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });

  it("stores the requested context in terminal panel params when opening a terminal panel", () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    const panelId = useWorkspaceStore.getState().addTerminal({
      context,
    });

    expect(panelId).toMatch(TERMINAL_PANEL_ID_PREFIX);
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: { context },
        title: "Terminal: /Users/xyz/ABC/pier",
      })
    );
  });

  it("keeps placement behavior when opening a terminal panel", () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      context,
      placement: "split-right",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { context },
        position: {
          direction: "right",
          referencePanel: "terminal-1",
        },
      })
    );
  });

  it("Cmd+W closes the active terminal panel when more than one panel exists", () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("does not close a native terminal when a web panel is explicitly closed", () => {
    const terminal = terminalPanel("terminal-1");
    const web = webPanel("welcome-1");
    const api = createApi([terminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closePanel("welcome-1");

    expect(window.pier.terminal.close).not.toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(web);
  });

  it("closes the native terminal when the active terminal panel is closed", () => {
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
  });

  it("Cmd+W closes the current window instead of removing the last panel", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeActivePanel();

    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).not.toHaveBeenCalled();
  });

  it("archives a last terminal panel before closing the window from closePanel", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(api.removePanel).not.toHaveBeenCalled();
    expect(
      firstInvocationOrder(vi.mocked(window.pier.terminal.close))
    ).toBeLessThan(firstInvocationOrder(closeCurrentWindowMock));
  });

  it("closes only panels from the same group during closeOthers", () => {
    const keep = terminalPanel("terminal-keep");
    const terminal = terminalPanel("terminal-close");
    const web = webPanel("welcome-close");
    const otherGroupTerminal = terminalPanel("terminal-other-group");
    const api = createApi(
      [keep, terminal, web, otherGroupTerminal],
      [{ panels: [keep, terminal, web] }, { panels: [otherGroupTerminal] }]
    );

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeOthers("terminal-keep");

    expect(window.pier.terminal.close).toHaveBeenCalledOnce();
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-close");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(api.removePanel).toHaveBeenCalledWith(web);
    expect(api.removePanel).not.toHaveBeenCalledWith(keep);
    expect(api.removePanel).not.toHaveBeenCalledWith(otherGroupTerminal);
  });

  it("clears layout before closing terminal panels during closeAll", async () => {
    const terminal = terminalPanel("terminal-1");
    const web = webPanel("welcome-1");
    const api = createApi([terminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeAll();

    expect(window.pier.getWindowContext).toHaveBeenCalled();
    expect(window.pier.workspace.clearLayout).toHaveBeenCalledWith(
      "record-current"
    );
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(api.removePanel).toHaveBeenCalledWith(web);
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(
      firstInvocationOrder(vi.mocked(window.pier.workspace.clearLayout))
    ).toBeLessThan(firstInvocationOrder(vi.mocked(window.pier.terminal.close)));
  });

  it("clears layout, closes old terminals, and rebuilds default terminal during resetLayout", async () => {
    const oldTerminal = terminalPanel("terminal-old");
    const web = webPanel("welcome-old");
    const api = createApi([oldTerminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().resetLayout();

    expect(window.pier.getWindowContext).toHaveBeenCalled();
    expect(window.pier.workspace.clearLayout).toHaveBeenCalledWith(
      "record-current"
    );
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-old");
    expect(api.removePanel).toHaveBeenCalledWith(oldTerminal);
    expect(api.removePanel).toHaveBeenCalledWith(web);
    expect(api.addPanel).toHaveBeenCalledWith({
      component: "terminal",
      id: "terminal-1",
      title: "Terminal",
    });
    expect(
      firstInvocationOrder(vi.mocked(window.pier.workspace.clearLayout))
    ).toBeLessThan(firstInvocationOrder(vi.mocked(window.pier.terminal.close)));
  });
});
