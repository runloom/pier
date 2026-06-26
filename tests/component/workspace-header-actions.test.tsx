import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
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
import {
  WorkspaceHeaderActions,
  WorkspaceHeaderRightActions,
} from "@/components/workspace/workspace-header-actions.tsx";
import { initI18n } from "@/i18n/index.ts";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

let setOverlayActive: ReturnType<typeof vi.fn>;
let disposePanelActions: (() => void) | null = null;
let originalHasPointerCapture:
  | typeof HTMLElement.prototype.hasPointerCapture
  | undefined;
let originalReleasePointerCapture:
  | typeof HTMLElement.prototype.releasePointerCapture
  | undefined;
let originalSetPointerCapture:
  | typeof HTMLElement.prototype.setPointerCapture
  | undefined;
let originalScrollIntoView:
  | typeof HTMLElement.prototype.scrollIntoView
  | undefined;

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

function createPanel(id: string, title: string) {
  return {
    api: {
      exitMaximized: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
      setActive: vi.fn(),
    },
    id,
    title,
    view: {
      contentComponent: "terminal",
    },
  };
}

function createProps(
  panels: ReturnType<typeof createPanel>[],
  groupCount = 1
): IDockviewHeaderActionsProps {
  const group = {};
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    id: `group-${index + 1}`,
  }));
  const containerApi = {
    activeGroup: group,
    activePanel: panels[0] ?? null,
    addPanel: vi.fn(),
    groups,
    panels,
  };
  return {
    activePanel: panels[0],
    api: {},
    containerApi,
    group,
    headerPosition: "top",
    isGroupActive: true,
    panels,
  } as unknown as IDockviewHeaderActionsProps;
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  disposePanelActions = registerPanelActions();
  setOverlayActive = vi.fn();
  originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
  originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
  originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  setDockviewTabRevealRoot(document);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  });
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => false),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    scrollIntoView: {
      configurable: true,
      value: vi.fn(),
    },
  });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        setOverlayActive,
      },
    },
  });
});

afterEach(() => {
  disposePanelActions?.();
  disposePanelActions = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setDockviewTabRevealRoot(null);
  useWorkspaceStore.getState().setApi(null);
  if (originalHasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
  }
  if (originalReleasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
  }
  if (originalSetPointerCapture) {
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  }
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  Reflect.deleteProperty(window, "pier");
});

describe("WorkspaceHeaderActions", () => {
  it("renders the panel size control in the right header action area", () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderRightActions {...props} />);

    expect(
      screen.getByRole("button", { name: "Toggle Panel Maximize" })
    ).toBeInTheDocument();
  });

  it("toggles the group active panel from the right header action area", () => {
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderRightActions {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle Panel Maximize" })
    );

    expect(panel.api.setActive).toHaveBeenCalledOnce();
    expect(panel.api.maximize).toHaveBeenCalledOnce();
  });

  it("does not render equalize in the tab row for split layouts", () => {
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel], 2);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderRightActions {...props} />);

    expect(
      screen.queryByRole("button", { name: "Equalize Panels" })
    ).not.toBeInTheDocument();
  });

  it("renders minimize in the right header action area for a maximized panel", () => {
    const panel = createPanel("terminal-1", "Terminal 1");
    vi.mocked(panel.api.isMaximized).mockReturnValue(true);
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderRightActions {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle Panel Maximize" })
    );

    expect(panel.api.setActive).toHaveBeenCalledOnce();
    expect(panel.api.exitMaximized).toHaveBeenCalledOnce();
  });

  it("renders a select trigger for clipped tabs", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondContent = document.createElement("div");
    const actionsContainer = document.createElement("div");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstContent.dataset.panelTabId = "terminal-1";
    secondContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstContent);
    secondTab.append(secondContent);
    tabsContainer.append(firstTab, secondTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          createPanel("terminal-2", "Terminal 2"),
        ])}
      />,
      { container: actionsContainer }
    );

    expect(
      await screen.findByRole("combobox", { name: "Hidden tabs" })
    ).toHaveTextContent("1");

    header.remove();
  });

  it("renders the overflow trigger when a tab is only partially clipped", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondContent = document.createElement("div");
    const actionsContainer = document.createElement("div");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstContent.dataset.panelTabId = "terminal-1";
    secondContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstContent);
    secondTab.append(secondContent);
    tabsContainer.append(firstTab, secondTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 80, right: 160, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          createPanel("terminal-2", "Terminal 2"),
        ])}
      />,
      { container: actionsContainer }
    );

    expect(
      await screen.findByRole("combobox", { name: "Hidden tabs" })
    ).toHaveTextContent("1");

    header.remove();
  });

  it("renders the overflow trigger when the tab strip collapses to zero width", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondContent = document.createElement("div");
    const actionsContainer = document.createElement("div");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstContent.dataset.panelTabId = "terminal-1";
    secondContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstContent);
    secondTab.append(secondContent);
    tabsContainer.append(firstTab, secondTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 120, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 80, right: 160, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          createPanel("terminal-2", "Terminal 2"),
        ])}
      />,
      { container: actionsContainer }
    );

    expect(
      await screen.findByRole("combobox", { name: "Hidden tabs" })
    ).toHaveTextContent("2");

    header.remove();
  });

  it("keeps a fixed overflow slot mounted when no tabs are clipped", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondContent = document.createElement("div");
    const actionsContainer = document.createElement("div");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstContent.dataset.panelTabId = "terminal-1";
    secondContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstContent);
    secondTab.append(secondContent);
    tabsContainer.append(firstTab, secondTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 240, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 80, right: 160, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          createPanel("terminal-2", "Terminal 2"),
        ])}
      />,
      { container: actionsContainer }
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("combobox", { name: "Hidden tabs" })
      ).not.toBeInTheDocument();
    });
    expect(
      actionsContainer.querySelector('[data-slot="panel-overflow"]')
    ).toHaveClass("w-16");

    header.remove();
  });

  it("pushes terminal overlay while the select list is open so options receive pointer events", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const visibleTab = document.createElement("div");
    const visibleContent = document.createElement("div");
    const overflowTab = document.createElement("div");
    const overflowContent = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const overflowPanel = createPanel("terminal-2", "Terminal 2");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    visibleTab.className = "dv-tab";
    overflowTab.className = "dv-tab";
    visibleContent.dataset.panelTabId = "terminal-1";
    overflowContent.dataset.panelTabId = "terminal-2";
    visibleTab.append(visibleContent);
    overflowTab.append(overflowContent);
    tabsContainer.append(visibleTab, overflowTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(visibleTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(overflowTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          overflowPanel,
        ])}
      />,
      { container: actionsContainer }
    );

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(setOverlayActive).toHaveBeenLastCalledWith(true);
    });
    const item = await screen.findByRole("option", {
      name: "Terminal 2",
    });
    expect(item).toHaveAttribute("data-slot", "select-item");
    expect(document.querySelector("[data-slot='select-content']")).toHaveClass(
      "w-48"
    );

    fireEvent.click(item);

    expect(overflowPanel.api.setActive).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(setOverlayActive).toHaveBeenLastCalledWith(false);
    });

    header.remove();
  });

  it("reveals the hidden tab when selecting it from the overflow list", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const visibleTab = document.createElement("div");
    const visibleContent = document.createElement("div");
    const overflowTab = document.createElement("div");
    const overflowContent = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const overflowPanel = createPanel("terminal-2", "xyz");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    visibleTab.className = "dv-tab";
    overflowTab.className = "dv-tab";
    visibleContent.dataset.panelTabId = "terminal-1";
    overflowContent.dataset.panelTabId = "terminal-2";
    visibleTab.append(visibleContent);
    overflowTab.append(overflowContent);
    tabsContainer.append(visibleTab, overflowTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    tabsContainer.scrollLeft = 0;
    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(visibleTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(overflowTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          overflowPanel,
        ])}
      />,
      { container: actionsContainer }
    );

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    fireEvent.click(
      await screen.findByRole("option", {
        name: "xyz",
      })
    );

    expect(overflowPanel.api.setActive).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(tabsContainer.scrollLeft).toBe(88);
    });

    header.remove();
  });

  it("uses the select native viewport for a long hidden tab list", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const panels = Array.from({ length: 8 }, (_, index) =>
      createPanel(`terminal-${index + 1}`, `Terminal ${index + 1}`)
    );

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";

    panels.forEach((panel, index) => {
      const tab = document.createElement("div");
      const content = document.createElement("div");
      tab.className = "dv-tab";
      content.dataset.panelTabId = panel.id;
      tab.append(content);
      tabsContainer.append(tab);
      setRect(tab, {
        bottom: 34,
        left: index * 80,
        right: index * 80 + 80,
        top: 0,
      });
    });

    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 80, top: 0 });

    render(<WorkspaceHeaderActions {...createProps(panels)} />, {
      container: actionsContainer,
    });

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    await screen.findByRole("option", {
      name: "Terminal 2",
    });
    const content = document.querySelector("[data-slot='select-content']");
    const viewport = document.querySelector("[data-radix-select-viewport]");
    expect(viewport).not.toBeNull();
    expect(content).toHaveAttribute("data-align-trigger", "false");
    expect(content).toHaveClass("w-48");
    expect(viewport).toHaveAttribute("data-position", "popper");
    expect(
      document.querySelector("[data-overflow-tabs-viewport]")
    ).not.toBeInTheDocument();

    header.remove();
  });

  it("reveals a terminal tab added from the header new-tab action", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const existingTab = document.createElement("div");
    const existingContent = document.createElement("div");
    const newTab = document.createElement("div");
    const newContent = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    existingTab.className = "dv-tab";
    newTab.className = "dv-tab";
    existingContent.dataset.panelTabId = "terminal-1";
    newContent.dataset.panelTabId = "terminal-123";
    existingTab.append(existingContent);
    newTab.append(newContent);
    tabsContainer.append(existingTab, newTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    tabsContainer.scrollLeft = 0;
    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(existingTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(newTab, { bottom: 34, left: 120, right: 200, top: 0 });
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />, {
      container: actionsContainer,
    });

    fireEvent.click(screen.getByRole("button", { name: "New Tab" }));

    expect(props.containerApi.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        id: "terminal-123",
        position: {
          direction: "within",
          referenceGroup: props.group,
        },
      })
    );
    expect(tabsContainer.scrollLeft).toBe(88);

    header.remove();
  });
});
