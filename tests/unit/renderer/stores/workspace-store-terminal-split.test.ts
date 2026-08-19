import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { resetFreshTerminalPanelsForTests } from "@/stores/terminal-panel-session-hints.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function mountHiddenTab(panelId: string): HTMLElement {
  const root = document.createElement("div");
  const tabsContainer = document.createElement("div");
  const tab = document.createElement("div");
  const content = document.createElement("div");
  tabsContainer.className = "dv-tabs-container";
  tab.className = "dv-tab";
  content.dataset.panelTabId = panelId;
  tab.append(content);
  tabsContainer.append(tab);
  root.append(tabsContainer);
  document.body.append(root);
  tabsContainer.scrollLeft = 0;
  tabsContainer.getBoundingClientRect = () =>
    ({
      bottom: 34,
      height: 34,
      left: 0,
      right: 120,
      top: 0,
      width: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  tab.getBoundingClientRect = () =>
    ({
      bottom: 34,
      height: 34,
      left: 120,
      right: 200,
      top: 0,
      width: 80,
      x: 120,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return root;
}

describe("workspace.store terminal split placement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setDockviewTabRevealRoot(document);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.spyOn(Date, "now").mockReturnValue(123);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        getWindowContext: vi.fn(async () => ({
          mode: "restore",
          recordId: "record-current",
          sessionId: "record-current",
          windowId: "main",
        })),
        terminal: { close: vi.fn() },
        workspace: { clearLayout: vi.fn(async () => undefined) },
      },
    });
    useWorkspaceStore.getState().setApi(null);
    resetFreshTerminalPanelsForTests();
  });

  afterEach(() => {
    setDockviewTabRevealRoot(null);
    useWorkspaceStore.getState().setApi(null);
    resetFreshTerminalPanelsForTests();
    Reflect.deleteProperty(window, "pier");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("splits relative to referencePanelId even when another pane is active", () => {
    const leader = terminalPanel("leader");
    const teammate = terminalPanel("teammate");
    const api = {
      activeGroup: { id: "group-1" },
      activePanel: leader,
      addPanel: vi.fn(),
      panels: [leader, teammate],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      placement: "split-below",
      referencePanelId: "teammate",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        position: { direction: "below", referencePanel: "teammate" },
      })
    );
  });

  it("falls back to the active panel when referencePanelId is omitted", () => {
    const leader = terminalPanel("leader");
    const teammate = terminalPanel("teammate");
    const api = {
      activeGroup: { id: "group-1" },
      activePanel: leader,
      addPanel: vi.fn(),
      panels: [leader, teammate],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      placement: "split-below",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        position: { direction: "below", referencePanel: "leader" },
      })
    );
  });

  it("throws when referencePanelId does not exist instead of falling back to active", () => {
    const leader = terminalPanel("leader");
    const api = {
      activeGroup: { id: "group-1" },
      activePanel: leader,
      addPanel: vi.fn(),
      panels: [leader],
    };
    useWorkspaceStore.getState().setApi(api as never);

    expect(() =>
      useWorkspaceStore.getState().addTerminal({
        placement: "split-below",
        referencePanelId: "ghost",
      })
    ).toThrow(/ghost/u);
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("does not activate or reveal when focus is false", () => {
    const root = mountHiddenTab("terminal-123");
    const leader = terminalPanel("leader");
    const openPanel = vi.fn();
    const added = {
      group: {
        activePanel: undefined,
        model: { openPanel },
      },
      id: "terminal-123",
    };
    const api = {
      activeGroup: { id: "group-1" },
      activePanel: leader,
      addPanel: vi.fn(),
      getPanel: vi.fn((id: string) =>
        id === "terminal-123" ? added : undefined
      ),
      panels: [leader],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      focus: false,
      placement: "split-below",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ inactive: true })
    );
    expect(openPanel).toHaveBeenCalledWith(added, {
      skipSetGroupActive: true,
    });
    expect(leader.api.setActive).not.toHaveBeenCalled();
    expect(
      root.querySelector<HTMLElement>(".dv-tabs-container")?.scrollLeft
    ).toBe(0);
    root.remove();
  });

  it("pins active-tab to referencePanelId even when another group is active", () => {
    const leader = terminalPanel("leader");
    const other = terminalPanel("other-group-term");
    const api = {
      activeGroup: { id: "group-other" },
      activePanel: other,
      addPanel: vi.fn(),
      panels: [leader, other],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      placement: "active-tab",
      referencePanelId: "leader",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        position: { direction: "within", referencePanel: "leader" },
      })
    );
  });

  it("does not force-show an inactive tab in an existing group", () => {
    const leader = terminalPanel("leader");
    const openPanel = vi.fn();
    const added = {
      group: {
        activePanel: leader,
        model: { openPanel },
      },
      id: "terminal-123",
    };
    const api = {
      activeGroup: { id: "group-1", panels: [leader] },
      activePanel: leader,
      addPanel: vi.fn(),
      getPanel: vi.fn((id: string) =>
        id === "terminal-123" ? added : undefined
      ),
      panels: [leader],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      focus: false,
      placement: "active-tab",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ inactive: true })
    );
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("still reveals when focus is omitted", () => {
    const root = mountHiddenTab("terminal-123");
    const leader = terminalPanel("leader");
    const api = {
      activeGroup: { id: "group-1" },
      activePanel: leader,
      addPanel: vi.fn(),
      panels: [leader],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({
      placement: "split-below",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.not.objectContaining({ inactive: true })
    );
    expect(
      root.querySelector<HTMLElement>(".dv-tabs-container")?.scrollLeft
    ).toBe(88);
    root.remove();
  });
});
