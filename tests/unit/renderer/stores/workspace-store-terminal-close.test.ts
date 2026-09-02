import type { PanelContext } from "@shared/contracts/panel.ts";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));
const TERMINAL_PANEL_ID_PREFIX = /^terminal-/;

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

import { touchGroup } from "@/lib/workspace/group-mru.ts";
import {
  clearPanelCloseGuards,
  registerPanelCloseGuard,
} from "@/lib/workspace/panel-close-guards.ts";
import { useTaskRunSelectionStore } from "@/stores/task-run-selection.store.ts";
import {
  requestTerminalRelaunch,
  useTerminalRelaunchRequest,
} from "@/stores/terminal-relaunch.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { useWorkspacePreferencesStore } from "@/stores/workspace-preferences.store.ts";

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
  const api = {
    activeGroup: groups[0] ?? null,
    activePanel: panels[0] ?? null,
    groups,
    addPanel: vi.fn(),
    panels,
    removePanel: vi.fn(),
    totalPanels: panels.length,
  };
  for (const panel of panels) {
    panel.api.setActive.mockImplementation(() => {
      api.activePanel = panel;
    });
  }
  return api;
}

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/dev/ABC/pier",
  openedPath: "/Users/dev/ABC/pier",
  projectRootPath: "/Users/dev/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/dev/ABC/pier",
};

function firstInvocationOrder(fn: { mock: { invocationCallOrder: number[] } }) {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error("expected mock to be called");
  }
  return order;
}

function lastInvocationOrder(fn: { mock: { invocationCallOrder: number[] } }) {
  const order = fn.mock.invocationCallOrder.at(-1);
  if (order === undefined) {
    throw new Error("expected mock to be called");
  }
  return order;
}

describe("workspace terminal close lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearPanelCloseGuards();
    closeCurrentWindowMock.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        env: { platform: "darwin" },
        window: {
          closeCurrent: vi.fn(async () => undefined),
          getContext: vi.fn(async () => ({
            mode: "restore",
            recordId: "record-current",
            sessionId: "record-current",
            windowId: "main",
          })),
        },
        workspace: { clearLayout: vi.fn(async () => undefined) },
        terminal: { close: vi.fn() },
      },
    });
    useWorkspaceStore.getState().setApi(null);
    useWorkspacePreferencesStore.setState({
      panelCloseFocusPolicy: "adjacent",
    });
  });

  it("closes the native terminal when a terminal panel is explicitly closed", async () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });

  it("clears a pending terminal relaunch request when that terminal panel is explicitly closed", async () => {
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

    await act(async () => {
      await useWorkspaceStore.getState().closePanel(panel.id);
    });

    expect(relaunch.result.current).toBeNull();
    expect(window.pier.terminal.close).toHaveBeenCalledWith(panel.id);
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });

  it("clears the selected task run when a terminal panel is closed", async () => {
    const panel = terminalPanel("terminal-run-selection-close");
    const api = createApi([panel, webPanel("welcome-1")]);
    useWorkspaceStore.getState().setApi(api as never);
    useTaskRunSelectionStore
      .getState()
      .selectPanelRun(panel.id, "run-selected");

    await useWorkspaceStore.getState().closePanel(panel.id);

    expect(
      useTaskRunSelectionStore.getState().selectedRunIdsByPanel[panel.id]
    ).toBeUndefined();
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
        title: "Terminal: /Users/dev/ABC/pier",
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

  it("Cmd+W closes the active terminal panel when more than one panel exists", async () => {
    const panel = terminalPanel("terminal-1");
    const api = createApi([panel, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("activates the right neighbor before removing the active panel", async () => {
    const left = terminalPanel("terminal-left");
    const middle = terminalPanel("terminal-middle");
    const right = webPanel("welcome-right");
    const api = createApi([left, middle, right]);
    api.activePanel = middle;

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeActivePanel();

    expect(right.api.setActive).toHaveBeenCalledOnce();
    expect(left.api.setActive).not.toHaveBeenCalled();
    expect(firstInvocationOrder(right.api.setActive)).toBeLessThan(
      firstInvocationOrder(api.removePanel)
    );
    expect(api.removePanel).toHaveBeenCalledWith(middle);
  });

  it("activates the left neighbor when the active panel is rightmost", async () => {
    const left = terminalPanel("terminal-left");
    const right = terminalPanel("terminal-right");
    const api = createApi([left, right]);
    api.activePanel = right;

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closePanel("terminal-right");

    expect(left.api.setActive).toHaveBeenCalledOnce();
    expect(firstInvocationOrder(left.api.setActive)).toBeLessThan(
      firstInvocationOrder(api.removePanel)
    );
    expect(api.removePanel).toHaveBeenCalledWith(right);
  });

  it("does not re-activate when closing an inactive panel", async () => {
    const active = terminalPanel("terminal-active");
    const inactive = webPanel("welcome-inactive");
    const api = createApi([active, inactive]);
    api.activePanel = active;

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closePanel("welcome-inactive");

    expect(active.api.setActive).not.toHaveBeenCalled();
    expect(inactive.api.setActive).not.toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(inactive);
  });

  it("skips adjacent pre-activation when panelCloseFocusPolicy is recent", async () => {
    const left = terminalPanel("terminal-left");
    const middle = terminalPanel("terminal-middle");
    const right = webPanel("welcome-right");
    const api = createApi([left, middle, right]);
    api.activePanel = middle;
    useWorkspacePreferencesStore.setState({
      panelCloseFocusPolicy: "recent",
    });

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeActivePanel();

    expect(left.api.setActive).not.toHaveBeenCalled();
    expect(right.api.setActive).not.toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(middle);
  });

  it("does not close a native terminal when a web panel is explicitly closed", async () => {
    const terminal = terminalPanel("terminal-1");
    const web = webPanel("welcome-1");
    const api = createApi([terminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closePanel("welcome-1");

    expect(window.pier.terminal.close).not.toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(web);
  });

  it("closes the native terminal when the active terminal panel is closed", async () => {
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal, webPanel("welcome-1")]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
  });

  it("Cmd+W closes the current window instead of removing the last panel", async () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeActivePanel();

    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).not.toHaveBeenCalled();
  });

  it("archives a last terminal panel before closing the window from closePanel", async () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(api.removePanel).not.toHaveBeenCalled();
    expect(
      firstInvocationOrder(vi.mocked(window.pier.terminal.close))
    ).toBeLessThan(firstInvocationOrder(closeCurrentWindowMock));
  });

  it("closes only panels from the same group during closeOthers", async () => {
    const keep = terminalPanel("terminal-keep");
    const terminal = terminalPanel("terminal-close");
    const web = webPanel("welcome-close");
    const otherGroupTerminal = terminalPanel("terminal-other-group");
    const api = createApi(
      [keep, terminal, web, otherGroupTerminal],
      [{ panels: [keep, terminal, web] }, { panels: [otherGroupTerminal] }]
    );

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeOthers("terminal-keep");

    expect(window.pier.terminal.close).toHaveBeenCalledOnce();
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-close");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(api.removePanel).toHaveBeenCalledWith(web);
    expect(api.removePanel).not.toHaveBeenCalledWith(keep);
    expect(api.removePanel).not.toHaveBeenCalledWith(otherGroupTerminal);
  });

  it("closeGroup removes only same-group panels and does not close window when other groups remain", async () => {
    const a = terminalPanel("g1-a");
    const b = webPanel("g1-b");
    const other = terminalPanel("g2-a");
    const panels = [a, b, other];
    const api = {
      activeGroup: { panels: [a, b] },
      activePanel: a,
      groups: [{ panels: [a, b] }, { panels: [other] }],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
      }),
      totalPanels: 3,
    };

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeGroup("g1-a");

    expect(api.removePanel).toHaveBeenCalledWith(a);
    expect(api.removePanel).toHaveBeenCalledWith(b);
    expect(api.removePanel).not.toHaveBeenCalledWith(other);
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("closeGroup activates the MRU remaining group before removing panels", async () => {
    const closingA = terminalPanel("br-a");
    const keep = webPanel("tr-keep");
    const first = webPanel("tl-first");
    const panels = [first, keep, closingA];
    const tl = { id: "tl", activePanel: first, panels: [first] };
    const tr = { id: "tr", activePanel: keep, panels: [keep] };
    const br = { id: "br", activePanel: closingA, panels: [closingA] };
    const api = {
      activeGroup: br,
      activePanel: closingA,
      groups: [tl, tr, br],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
      }),
      totalPanels: 3,
    };

    useWorkspaceStore.getState().setApi(api as never);
    touchGroup("tl");
    touchGroup("tr");
    touchGroup("br");
    await useWorkspaceStore.getState().closeGroup("br-a");

    expect(keep.api.setActive).toHaveBeenCalled();
    expect(first.api.setActive).not.toHaveBeenCalled();
    expect(firstInvocationOrder(keep.api.setActive)).toBeLessThan(
      firstInvocationOrder(api.removePanel)
    );
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("closeGroup re-applies the MRU successor after dockview steals to groups[0]", async () => {
    const closingActive = terminalPanel("br-active");
    const closingSibling = webPanel("br-sibling");
    const keep = webPanel("tr-keep");
    const first = webPanel("tl-first");
    const panels = [first, keep, closingActive, closingSibling];
    const tl = { id: "tl", activePanel: first, panels: [first] };
    const tr = { id: "tr", activePanel: keep, panels: [keep] };
    const br = {
      id: "br",
      activePanel: closingActive,
      panels: [closingActive, closingSibling],
    };
    const dyingIds = new Set([closingActive.id, closingSibling.id]);
    const api = {
      activeGroup: br,
      activePanel: closingActive,
      groups: [tl, tr, br],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
        const dyingLeft = panels.filter((p) => dyingIds.has(p.id));
        api.activePanel = dyingLeft[0] ?? first;
      }),
      totalPanels: 4,
    };

    useWorkspaceStore.getState().setApi(api as never);
    touchGroup("tl");
    touchGroup("tr");
    touchGroup("br");
    await useWorkspaceStore.getState().closeGroup("br-active");

    expect(api.removePanel).toHaveBeenCalledWith(closingSibling);
    expect(api.removePanel).toHaveBeenCalledWith(closingActive);
    expect(lastInvocationOrder(keep.api.setActive)).toBeGreaterThan(
      lastInvocationOrder(api.removePanel)
    );
    expect(first.api.setActive).not.toHaveBeenCalled();
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("closeGroup does not move focus when a close guard is cancelled", async () => {
    const focused = terminalPanel("g1-focused");
    const sibling = webPanel("g1-sibling");
    const keep = webPanel("g2-keep");
    const panels = [focused, sibling, keep];
    const g1 = {
      id: "g1",
      activePanel: focused,
      panels: [focused, sibling],
    };
    const g2 = { id: "g2", activePanel: keep, panels: [keep] };
    const api = {
      activeGroup: g1,
      activePanel: focused,
      groups: [g1, g2],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
      }),
      totalPanels: 3,
    };
    registerPanelCloseGuard("terminal", async () => false);

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeGroup("g1-focused");

    expect(keep.api.setActive).not.toHaveBeenCalled();
    expect(api.removePanel).not.toHaveBeenCalledWith(focused);
    expect(api.removePanel).toHaveBeenCalledWith(sibling);
  });

  it("closeGroup of an inactive group does not steal window focus", async () => {
    const focused = terminalPanel("focused");
    const otherA = webPanel("other-a");
    const otherB = webPanel("other-b");
    const panels = [focused, otherA, otherB];
    const gFocus = { id: "g-focus", activePanel: focused, panels: [focused] };
    const gOther = {
      id: "g-other",
      activePanel: otherA,
      panels: [otherA, otherB],
    };
    const api = {
      activeGroup: gFocus,
      activePanel: focused,
      groups: [gFocus, gOther],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
        // Simulate dockview activating the dying group.
        if (panel.id === otherA.id || panel.id === otherB.id) {
          api.activePanel = otherA;
        }
      }),
      totalPanels: 3,
    };

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeGroup("other-a");

    expect(focused.api.setActive).toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(otherA);
    expect(api.removePanel).toHaveBeenCalledWith(otherB);
    expect(api.removePanel).not.toHaveBeenCalledWith(focused);
  });

  it("closes the last tab in a group by activating the remaining group", async () => {
    const closing = terminalPanel("g1-last");
    const keep = webPanel("g2-keep");
    const g1 = { id: "g1", activePanel: closing, panels: [closing] };
    const g2 = { id: "g2", activePanel: keep, panels: [keep] };
    const api = createApi([closing, keep], [g1, g2]);
    api.activeGroup = g1;
    api.activePanel = closing;
    api.totalPanels = 2;

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closePanel("g1-last");

    expect(keep.api.setActive).toHaveBeenCalledOnce();
    expect(firstInvocationOrder(keep.api.setActive)).toBeLessThan(
      firstInvocationOrder(api.removePanel)
    );
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("closeOthers in an inactive group does not steal window focus", async () => {
    const focused = terminalPanel("focused");
    const keep = webPanel("keep");
    const extra = webPanel("extra");
    const gFocus = { id: "g-focus", activePanel: focused, panels: [focused] };
    const gOther = { id: "g-other", activePanel: keep, panels: [keep, extra] };
    const api = createApi([focused, keep, extra], [gFocus, gOther]);
    api.activeGroup = gFocus;
    api.activePanel = focused;
    api.removePanel = vi.fn(() => {
      api.activePanel = extra;
    });

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeOthers("keep");

    expect(focused.api.setActive).toHaveBeenCalled();
    expect(api.removePanel).toHaveBeenCalledWith(extra);
    expect(api.removePanel).not.toHaveBeenCalledWith(focused);
    expect(api.removePanel).not.toHaveBeenCalledWith(keep);
  });

  it("closeOthers does not steal focus when the active tab's guard is cancelled", async () => {
    const keep = webPanel("keep");
    const focused = terminalPanel("focused");
    const extra = webPanel("extra");
    const api = createApi([keep, focused, extra]);
    api.activePanel = focused;
    registerPanelCloseGuard("terminal", async () => false);

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeOthers("keep");

    expect(keep.api.setActive).not.toHaveBeenCalled();
    expect(api.removePanel).not.toHaveBeenCalledWith(focused);
    expect(api.removePanel).toHaveBeenCalledWith(extra);
  });

  it("closeGroup closes the window when it empties the last group", async () => {
    const a = terminalPanel("solo-a");
    const b = webPanel("solo-b");
    const panels = [a, b];
    const api = {
      activeGroup: { panels: [a, b] },
      activePanel: a,
      groups: [{ panels: [a, b] }],
      addPanel: vi.fn(),
      panels,
      removePanel: vi.fn((panel: { id: string }) => {
        const index = panels.findIndex((p) => p.id === panel.id);
        if (index >= 0) {
          panels.splice(index, 1);
        }
      }),
      totalPanels: 2,
    };

    useWorkspaceStore.getState().setApi(api as never);
    await useWorkspaceStore.getState().closeGroup("solo-a");

    expect(api.removePanel).toHaveBeenCalledWith(a);
    expect(api.removePanel).toHaveBeenCalledWith(b);
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
  });

  it("clears layout after all panels close during closeAll", async () => {
    const terminal = terminalPanel("terminal-1");
    const web = webPanel("welcome-1");
    const api = createApi([terminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeAll();

    expect(window.pier.window.getContext).toHaveBeenCalled();
    expect(window.pier.workspace.clearLayout).toHaveBeenCalledWith(
      "record-current"
    );
    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(api.removePanel).toHaveBeenCalledWith(web);
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(
      firstInvocationOrder(vi.mocked(window.pier.terminal.close))
    ).toBeLessThan(
      firstInvocationOrder(vi.mocked(window.pier.workspace.clearLayout))
    );
    expect(
      firstInvocationOrder(vi.mocked(window.pier.workspace.clearLayout))
    ).toBeLessThan(firstInvocationOrder(closeCurrentWindowMock));
  });

  it("does not clear persisted layout or close panels when closeAll is canceled by a guard", async () => {
    const web = webPanel("welcome-1");
    const terminal = terminalPanel("terminal-1");
    const api = createApi([web, terminal]);
    const guard = vi.fn(async () => false);

    registerPanelCloseGuard("welcome", guard);
    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeAll();

    expect(guard).toHaveBeenCalledWith({
      closingPanelIds: ["welcome-1", "terminal-1"],
      componentId: "welcome",
      panelId: "welcome-1",
      params: undefined,
    });
    expect(window.pier.workspace.clearLayout).not.toHaveBeenCalled();
    expect(window.pier.terminal.close).not.toHaveBeenCalled();
    expect(api.removePanel).not.toHaveBeenCalled();
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("keeps closeAll cancellation consistent after earlier panels were closed", async () => {
    const terminal = terminalPanel("terminal-1");
    const web = webPanel("welcome-1");
    const api = createApi([terminal, web]);
    const guard = vi.fn(async () => false);

    registerPanelCloseGuard("welcome", guard);
    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeAll();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(api.removePanel).not.toHaveBeenCalledWith(web);
    expect(window.pier.workspace.clearLayout).not.toHaveBeenCalled();
    expect(closeCurrentWindowMock).not.toHaveBeenCalled();
  });

  it("clears layout, closes old terminals, and rebuilds default terminal during resetLayout", async () => {
    const oldTerminal = terminalPanel("terminal-old");
    const web = webPanel("welcome-old");
    const api = createApi([oldTerminal, web]);

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().resetLayout();

    expect(window.pier.window.getContext).toHaveBeenCalled();
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
