import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">
): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom,
      height: rect.bottom - rect.top,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.right - rect.left,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
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
  setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
  setRect(tab, { bottom: 34, left: 120, right: 200, top: 0 });
  return root;
}

function scrollLeftFor(root: HTMLElement): number {
  return root.querySelector<HTMLElement>(".dv-tabs-container")?.scrollLeft ?? 0;
}

function terminalPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function group(id: string, panel: ReturnType<typeof terminalPanel>) {
  const element = document.createElement("div");
  return {
    activePanel: panel,
    element,
    id,
    panels: [panel],
  };
}

describe("workspace.store panel reveal policy", () => {
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
  });

  afterEach(() => {
    setDockviewTabRevealRoot(null);
    useWorkspaceStore.getState().setApi(null);
    Reflect.deleteProperty(window, "pier");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("reveals a panel added through addPanel", () => {
    const root = mountHiddenTab("welcome-1");
    const api = {
      addPanel: vi.fn(),
      panels: [],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addPanel({
      component: "welcome",
      id: "welcome-1",
      title: "Welcome",
    });

    expect(api.addPanel).toHaveBeenCalled();
    expect(scrollLeftFor(root)).toBe(88);
    root.remove();
  });

  it("reveals a newly added terminal tab", () => {
    const activePanel = terminalPanel("terminal-1");
    const root = mountHiddenTab("terminal-123");
    const api = {
      activeGroup: { id: "group-1" },
      activePanel,
      addPanel: vi.fn(),
      panels: [activePanel],
    };
    useWorkspaceStore.getState().setApi(api as never);

    const panelId = useWorkspaceStore.getState().addTerminal();

    expect(panelId).toBe("terminal-123");
    expect(scrollLeftFor(root)).toBe(88);
    root.remove();
  });

  it("reveals a split panel target", () => {
    const activePanel = terminalPanel("terminal-1");
    const root = mountHiddenTab("terminal-123");
    const api = {
      addPanel: vi.fn(),
      panels: [activePanel],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().splitPanel("terminal-1", "right");

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "terminal-123" })
    );
    expect(scrollLeftFor(root)).toBe(88);
    root.remove();
  });

  it("reveals the target panel when focusing another group", () => {
    const activePanel = terminalPanel("terminal-1");
    const targetPanel = terminalPanel("terminal-2");
    const activeGroup = group("group-1", activePanel);
    const targetGroup = group("group-2", targetPanel);
    const root = mountHiddenTab("terminal-2");
    setRect(activeGroup.element, { bottom: 100, left: 0, right: 100, top: 0 });
    setRect(targetGroup.element, {
      bottom: 100,
      left: 110,
      right: 210,
      top: 0,
    });
    const api = {
      activeGroup,
      groups: [activeGroup, targetGroup],
      panels: [activePanel, targetPanel],
    };
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().focusGroup("right");

    expect(targetPanel.api.setActive).toHaveBeenCalledOnce();
    expect(scrollLeftFor(root)).toBe(88);
    root.remove();
  });

  it("reveals the default terminal after resetLayout", async () => {
    const oldPanel = terminalPanel("terminal-old");
    const root = mountHiddenTab("terminal-1");
    const api = {
      addPanel: vi.fn(),
      panels: [oldPanel],
      removePanel: vi.fn(),
    };
    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().resetLayout();

    expect(api.addPanel).toHaveBeenCalledWith({
      component: "terminal",
      id: "terminal-1",
      title: "Terminal",
    });
    expect(scrollLeftFor(root)).toBe(88);
    root.remove();
  });
});
