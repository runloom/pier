import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
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

function scrollLeftFor(root: HTMLElement): number {
  return root.querySelector<HTMLElement>(".dv-tabs-container")?.scrollLeft ?? 0;
}

describe("panel tab focus actions", () => {
  let disposePanelActions: (() => void) | null = null;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
  });

  afterEach(() => {
    disposePanelActions?.();
    disposePanelActions = null;
    setDockviewTabRevealRoot(null);
    useWorkspaceStore.getState().setApi(null);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("activates the numbered tab in the currently focused group", async () => {
    const first = terminalPanel("terminal-1");
    const second = terminalPanel("terminal-2");
    const third = terminalPanel("terminal-3");
    const activeGroup = {
      activePanel: first,
      id: "group-1",
      panels: [first, second, third],
    };
    const api = {
      activeGroup,
      panels: [first, second, third],
    };
    const root = mountHiddenTab("terminal-2");
    setDockviewTabRevealRoot(document);
    useWorkspaceStore.getState().setApi(api as never);

    disposePanelActions = registerPanelActions();
    const action = actionRegistry.get("pier.panel.focusTab2");
    expect(action).toBeDefined();

    await action?.handler();

    expect(second.api.setActive).toHaveBeenCalledOnce();
    expect(first.api.setActive).not.toHaveBeenCalled();
    expect(third.api.setActive).not.toHaveBeenCalled();
    expect(scrollLeftFor(root)).toBe(88);
  });

  it("ignores tab numbers outside the active group", () => {
    const first = terminalPanel("terminal-1");
    const second = terminalPanel("terminal-2");
    const activeGroup = {
      activePanel: first,
      id: "group-1",
      panels: [first, second],
    };
    const api = {
      activeGroup,
      panels: [first, second],
    };
    const state = useWorkspaceStore.getState() as ReturnType<
      typeof useWorkspaceStore.getState
    > & {
      activateTabInActiveGroup?: (index: number) => void;
    };
    useWorkspaceStore.getState().setApi(api as never);

    expect(state.activateTabInActiveGroup).toEqual(expect.any(Function));
    state.activateTabInActiveGroup?.(8);

    expect(first.api.setActive).not.toHaveBeenCalled();
    expect(second.api.setActive).not.toHaveBeenCalled();
  });
});
