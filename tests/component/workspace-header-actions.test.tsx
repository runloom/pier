import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const feedbackMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: feedbackMocks.toastError },
}));
vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: feedbackMocks.showAppAlert,
}));

let applyInputRouting: ReturnType<typeof vi.fn>;
let detectAgents: ReturnType<typeof vi.fn>;
let disposePanelActions: (() => void) | null = null;
let disposeWorktreeCreateAction: (() => void) | null = null;
let prepareAgentLaunch: ReturnType<typeof vi.fn>;
let selectAgents: ReturnType<typeof vi.fn>;
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

function openAddPanelMenu(): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Add Panel" });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return trigger;
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  feedbackMocks.showAppAlert.mockClear();
  feedbackMocks.toastError.mockClear();
  disposePanelActions = registerPanelActions();
  applyInputRouting = vi.fn();
  detectAgents = vi.fn(async () => ({ detectedIds: [] as AgentKind[] }));
  prepareAgentLaunch = vi.fn(async () => ({ launchId: null as string | null }));
  selectAgents = vi.fn(async () => ({
    detectedIds: [] as AgentKind[],
    enabledIds: [] as AgentKind[],
    rankedIds: [] as AgentKind[],
    selectedId: null as AgentKind | null,
  }));
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
        applyInputRouting,
      },
      agents: {
        detect: detectAgents,
        prepareLaunch: prepareAgentLaunch,
        selection: selectAgents,
      },
      onWindowLayoutPulse: vi.fn(() => vi.fn()),
      worktrees: {
        list: vi.fn(async () => ({
          currentPath: "/repo",
          mainPath: "/repo",
          path: "/repo",
          status: "available",
          worktrees: [],
        })),
      },
      git: {
        listBranches: vi.fn(async () => []),
      },
      preferences: {
        read: vi.fn(async () => ({})),
      },
    },
  });
});

afterEach(() => {
  disposePanelActions?.();
  disposePanelActions = null;
  disposeWorktreeCreateAction?.();
  disposeWorktreeCreateAction = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setDockviewTabRevealRoot(null);
  useWorkspaceStore.getState().setApi(null);
  usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
  useAgentDetectStore.setState({
    detectedIds: [],
    hasDetected: false,
    isDetecting: false,
    isRefreshing: false,
  });
  useAgentPreferencesStore.setState({
    defaultAgentId: null,
    disabledAgentIds: [],
  });
  useCommandPaletteController.setState({
    mode: "commands",
    open: false,
    quickPick: null,
    requestId: 0,
    stack: [],
  });
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

  it("keeps a zero-width overflow anchor mounted when no tabs are clipped", async () => {
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
    const overflowAnchor = actionsContainer.querySelector(
      '[data-slot="panel-overflow"]'
    );
    expect(overflowAnchor).toHaveClass("w-0", "overflow-hidden");
    expect(overflowAnchor).not.toHaveClass("w-16");

    header.remove();
  });

  it("shows overflow options and activates the selected hidden tab", async () => {
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

    const item = await screen.findByRole("option", {
      name: "Terminal 2",
    });
    expect(item).toHaveAttribute("data-slot", "select-item");
    expect(document.querySelector("[data-slot='select-content']")).toHaveClass(
      "w-48"
    );

    fireEvent.click(item);

    expect(overflowPanel.api.setActive).toHaveBeenCalledTimes(1);

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

  it("reveals a terminal tab added from the header add-panel menu", async () => {
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

    openAddPanelMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New Terminal" })
    );

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

  it("opens the task quick pick from the header add-panel menu", async () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "New Task" }));

    expect(useCommandPaletteController.getState()).toMatchObject({
      mode: "quick-pick",
      open: true,
      quickPick: {
        items: [
          {
            disabled: true,
            id: "task-no-context",
            label: "No active project",
          },
        ],
      },
    });
  });

  it("invokes the registered worktree create action when enabled", async () => {
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled: () => true,
      handler,
      id: "pier.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Create Worktree",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New Worktree" })
    );

    await waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  it("disables New Worktree when the registered action reports disabled", async () => {
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled: () => false,
      handler,
      id: "pier.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Create Worktree",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    const item = await screen.findByRole("menuitem", { name: "New Worktree" });
    expect(item).toHaveAttribute("aria-disabled", "true");
  });

  it("disables New Worktree when no action is registered", async () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    const item = await screen.findByRole("menuitem", { name: "New Worktree" });
    expect(item).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps New Worktree reactive to active panel context changes", async () => {
    // enabled() 读取 usePanelDescriptorStore 的实时快照 (镜像 git 插件的
    // activeWorktreeTarget 实现), 而不是测试注册时捕获的闭包值 —— 这样才能
    // 验证组件本身对 store 变化保持反应式, 而非碰巧因为别的 state 变了才重渲。
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled: () =>
        usePanelDescriptorStore.getState().activeId === "git-panel",
      handler,
      id: "pier.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Create Worktree",
    });
    usePanelDescriptorStore.setState({
      activeId: "git-panel",
      descriptors: {
        "git-panel": { display: { short: "Git Panel" } },
      },
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    const item = await screen.findByRole("menuitem", { name: "New Worktree" });
    expect(item).not.toHaveAttribute("aria-disabled", "true");

    // 模拟用户把 active panel 切到一个非 git 上下文的 terminal —— 不触发任何
    // 无关 state (agent 检测等), 只改 usePanelDescriptorStore。
    act(() => {
      usePanelDescriptorStore.getState().setActive("plain-panel");
    });

    await waitFor(() => {
      expect(
        screen.getByRole("menuitem", { name: "New Worktree" })
      ).toHaveAttribute("aria-disabled", "true");
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("catches handler rejections and logs errors when the worktree action throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error");
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled: () => true,
      handler,
      id: "pier.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Create Worktree",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New Worktree" })
    );

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    expect(consoleErrorSpy.mock.calls[0]?.[1]?.message).toBe("boom");
  });

  it("subscriptions to active panel context re-render component on context change", async () => {
    // This test verifies that the component's subscription to descriptor context
    // (not just activeId) allows the New Worktree menu item's disabled state to update
    // when the active panel's context changes (e.g., user cd-ing to different directory).
    const enabledStates: boolean[] = [];
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled: () => {
        const state = usePanelDescriptorStore.getState();
        const descriptor = state.activeId
          ? state.descriptors[state.activeId]
          : null;
        const isEnabled = descriptor?.context?.cwd === "/repo";
        enabledStates.push(isEnabled);
        return isEnabled;
      },
      handler,
      id: "pier.worktree.create",
      surfaces: ["command-palette"],
      title: () => "Create Worktree",
    });
    usePanelDescriptorStore.setState({
      activeId: "panel-1",
      descriptors: {
        "panel-1": {
          display: { short: "Panel" },
          context: {
            contextId: "ctx-1",
            cwd: "/repo",
            projectRootPath: "/repo",
            updatedAt: 0,
          },
        },
      },
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    // First menu open - enabled() should be called
    const initialCallCount = enabledStates.length;
    openAddPanelMenu();
    await screen.findByRole("menuitem", { name: "New Worktree" });

    // Update store: replace context object (same activeId but different cwd)
    // This simulates user cd-ing to a different directory in the active terminal
    act(() => {
      const state = usePanelDescriptorStore.getState();
      usePanelDescriptorStore.setState({
        descriptors: {
          ...state.descriptors,
          "panel-1": {
            display: { short: "Panel" },
            context: {
              contextId: "ctx-1",
              cwd: "/different",
              projectRootPath: "/different",
              updatedAt: 1,
            },
          },
        },
      });
    });

    // After store update, component should have re-rendered and enabled()
    // should have been called again with the new context
    expect(enabledStates.length).toBeGreaterThan(initialCallCount);
    // Verify that enabled() observed both true and false states
    expect(enabledStates).toContain(true);
    expect(enabledStates).toContain(false);
  });

  it("launches an agent terminal in the clicked header group", async () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    const originalGroup = props.group;
    prepareAgentLaunch.mockResolvedValueOnce({ launchId: "launch-agent" });
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState({
      defaultAgentId: null,
      disabledAgentIds: [],
    });
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelMenu();
    (props.containerApi as { activeGroup: unknown }).activeGroup = {
      id: "other-group",
    };
    fireEvent.click(await screen.findByRole("menuitem", { name: "Claude" }));

    await waitFor(() => {
      expect(prepareAgentLaunch).toHaveBeenCalledWith("claude");
      expect(props.containerApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "terminal",
          id: "terminal-456",
          params: { launchId: "launch-agent" },
          position: {
            direction: "within",
            referenceGroup: originalGroup,
          },
        })
      );
    });
  });

  it("agent 启动准备返回不可用时展示短失败提示", async () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    prepareAgentLaunch.mockResolvedValueOnce({ launchId: null });
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Claude" }));

    await waitFor(() => {
      expect(feedbackMocks.toastError).toHaveBeenCalledWith(
        "Agent is no longer available"
      );
    });
    expect(props.containerApi.addPanel).not.toHaveBeenCalled();
  });

  it("agent 启动准备异常时用宿主弹窗展示技术详情", async () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    prepareAgentLaunch.mockRejectedValueOnce(new Error("prepare IPC failed"));
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Claude" }));

    await waitFor(() => {
      expect(feedbackMocks.showAppAlert).toHaveBeenCalledWith({
        body: "prepare IPC failed",
        title: "Failed to Start Agent",
      });
    });
    expect(props.containerApi.addPanel).not.toHaveBeenCalled();
  });

  it("按实时探测和禁用快照重新过滤缓存排名", async () => {
    selectAgents.mockResolvedValue({
      detectedIds: ["claude", "codex"],
      enabledIds: ["claude", "codex"],
      rankedIds: ["codex", "claude"],
      selectedId: "codex",
    });
    useAgentDetectStore.setState({
      detectedIds: ["claude", "codex"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState({
      defaultAgentId: null,
      disabledAgentIds: [],
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Codex" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Claude" })
    ).toBeInTheDocument();

    act(() => {
      useAgentPreferencesStore.setState({ disabledAgentIds: ["codex"] });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Codex" })
      ).not.toBeInTheDocument();
    });

    act(() => {
      useAgentPreferencesStore.setState({ disabledAgentIds: [] });
      useAgentDetectStore.setState({
        detectedIds: ["claude", "gemini"],
        hasDetected: true,
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Codex" })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Gemini" })
      ).toBeInTheDocument();
    });
  });
});
