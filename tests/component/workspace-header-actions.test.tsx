import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  act,
  cleanup,
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
  type Mock,
  vi,
} from "vitest";
import {
  WorkspaceHeaderActions,
  WorkspaceHeaderRightActions,
} from "@/components/workspace/workspace-header-actions.tsx";
import { initI18n } from "@/i18n/index.ts";
import { registerAgentStartActions } from "@/lib/actions/agent-start-actions.ts";
import { registerNewAgentAction } from "@/lib/actions/new-agent-action.ts";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

let applyInputRouting: Mock;
let detectAgents: Mock;
let disposeAgentStartActions: (() => void) | null = null;
let disposeNewAgentAction: (() => void) | null = null;
let disposePanelActions: (() => void) | null = null;
let disposeRunActions: (() => void) | null = null;
let disposeWorktreeCreateAction: (() => void) | null = null;
let prepareAgentLaunch: Mock;
const defaultEnsureDetected = useAgentDetectStore.getState().ensureDetected;
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

const IME_KEY_STATES = [
  ["composition", { isComposing: true }],
  ["keyCode 229", { keyCode: 229 }],
] as const;

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

interface TestPanel {
  api: {
    exitMaximized: Mock;
    isMaximized: Mock<() => boolean>;
    maximize: Mock;
    onDidTitleChange: Mock;
    setActive: Mock;
  };
  id: string;
  title: string;
  view: {
    contentComponent: string;
  };
}

function createPanel(id: string, title: string): TestPanel {
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
  panels: TestPanel[],
  groupCount = 1
): IDockviewHeaderActionsProps {
  const activePanel = panels[0] ?? null;
  const group = {
    activePanel,
    id: "group-1",
    panels,
  };
  const groups = Array.from({ length: groupCount }, (_, index) =>
    index === 0
      ? group
      : {
          activePanel: null,
          id: `group-${index + 1}`,
          panels: [],
        }
  );
  const containerApi = {
    activeGroup: group,
    activePanel,
    addPanel: vi.fn(),
    groups,
    panels,
  };
  return {
    activePanel,
    api: {},
    containerApi,
    group,
    headerPosition: "top",
    isGroupActive: true,
    panels,
  } as unknown as IDockviewHeaderActionsProps;
}

function openAddPanelPopover(): HTMLElement {
  const trigger = screen.getByRole("button", {
    name: "Create in this panel group",
  });
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(trigger);
  return trigger;
}

async function findCommandItem(label: string): Promise<HTMLElement> {
  const labelElement = await screen.findByText(label, { selector: "span" });
  const item = labelElement.closest<HTMLElement>("[cmdk-item]");
  if (!item) {
    throw new Error(`Command item not found for ${label}`);
  }
  return item;
}

function visibleCommandItemLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]")).map(
    (item) => {
      const label = item.querySelector(":scope > span.min-w-0.flex-1");
      return label?.textContent ?? "";
    }
  );
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  useKeybindingScope.setState({
    activePanelComponent: null,
    activePanelId: null,
    activePanelKind: null,
    overlayStack: [],
  });
  keybindingRegistry.loadUserKeymap([]);
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
  disposePanelActions = registerPanelActions();
  applyInputRouting = vi.fn();
  detectAgents = vi.fn(async () => ({ detectedIds: [] as AgentKind[] }));
  prepareAgentLaunch = vi.fn(async () => ({ launchId: null as string | null }));
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
  disposeNewAgentAction = registerNewAgentAction();
  disposeRunActions = registerRunActions();
  disposeAgentStartActions = registerAgentStartActions();
  useCommandPaletteMru.setState({
    entries: [],
    frecencyMap: new Map(),
  });
});

afterEach(() => {
  cleanup();
  disposeAgentStartActions?.();
  disposeAgentStartActions = null;
  disposeNewAgentAction?.();
  disposeNewAgentAction = null;
  disposeRunActions?.();
  disposeRunActions = null;
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
    ensureDetected: defaultEnsureDetected,
  });
  useKeybindingScope.setState({
    activePanelComponent: null,
    activePanelId: null,
    activePanelKind: null,
    overlayStack: [],
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
  resetAppDialogForTests();
  useCommandPaletteMru.setState({
    entries: [],
    frecencyMap: new Map(),
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

  it("opens one searchable creator with direct agent actions", async () => {
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "worktree",
      disabledReason: () => "Open a project first",
      enabled: () => false,
      handler: vi.fn(),
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree", sortOrder: 2 },
      surfaces: ["command-palette", "create-menu"],
      title: () => "Create Worktree",
    });
    useAgentDetectStore.setState({
      detectedIds: ["claude", "codex"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState({
      defaultAgentId: "claude",
      disabledAgentIds: [],
    });
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    const trigger = openAddPanelPopover();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const title = await screen.findByText("Create in this panel group", {
      selector: "[data-slot='popover-title']",
    });
    const content = title.closest("[data-slot='popover-content']");
    expect(content).toHaveAccessibleName("Create in this panel group");
    expect(content).toHaveStyle({
      maxWidth: "calc(var(--radix-popover-content-available-width) - 0.5rem)",
    });
    const search = screen.getByPlaceholderText("Search panel types or agents…");
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    const listbox = screen.getByRole("listbox", {
      name: "Create in this panel group",
    });
    expect(listbox).toBeInTheDocument();
    expect(listbox).toHaveAttribute("data-scrollbar", "overlay");
    expect(listbox).not.toHaveClass("no-scrollbar");
    expect(visibleCommandItemLabels()).toEqual([
      "New Terminal",
      "Start Claude",
      "Start Codex",
      "Run Task…",
      "New Mission Control",
      "Create Worktree",
      "New Window",
    ]);
    expect(
      screen.getByText("Run", { selector: "[cmdk-group-heading]" })
    ).toBeVisible();
    expect(
      screen.getByText("Panel", { selector: "[cmdk-group-heading]" })
    ).toBeVisible();
    expect(
      screen.getByText("Worktree", { selector: "[cmdk-group-heading]" })
    ).toBeVisible();
    expect(await findCommandItem("Create Worktree")).toHaveTextContent(
      "Open a project first"
    );
    expect(
      (await findCommandItem("New Terminal")).querySelector("[data-slot='kbd']")
    ).toHaveTextContent(/^(?:⌘|Ctrl\+)T$/);
    expect(
      (await findCommandItem("Start Claude")).querySelector("[data-slot='kbd']")
    ).toHaveTextContent(/^(?:⌘⇧A|Ctrl\+Shift\+A)$/);
    expect(panel.api.setActive).toHaveBeenCalledOnce();
  });

  it("shows an explicit agent shortcut before the borrowed default shortcut", async () => {
    keybindingRegistry.loadUserKeymap([
      {
        commandId: "pier.agent.start.claude",
        keys: "Mod+Alt+KeyA",
        scope: "global",
      },
      {
        commandId: "-pier.agent.new",
        keys: "",
        scope: "global",
      },
    ]);
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState({
      defaultAgentId: "claude",
      disabledAgentIds: [],
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    expect(
      (await findCommandItem("Start Claude")).querySelector("[data-slot='kbd']")
    ).toHaveTextContent(/^(?:⌘⌥A|Ctrl\+Alt\+A)$/);
  });

  it("executes the highlighted create action from the search field", async () => {
    vi.spyOn(Date, "now").mockReturnValue(321);
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const search = screen.getByPlaceholderText("Search panel types or agents…");
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    fireEvent.keyDown(search, { code: "Enter", key: "Enter" });

    expect(props.containerApi.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        id: "terminal-321",
      })
    );
    expect(document.querySelector("[data-slot='popover-content']")).toBeNull();
  });

  it("searches every create action, including agent command aliases", async () => {
    useAgentDetectStore.setState({
      detectedIds: ["claude", "codex", "crush"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const search = screen.getByPlaceholderText("Search panel types or agents…");
    fireEvent.change(search, { target: { value: "cod" } });
    await waitFor(() => {
      expect(visibleCommandItemLabels()).toEqual(["Start Codex"]);
    });

    fireEvent.change(search, { target: { value: "crush" } });
    await waitFor(() => {
      expect(visibleCommandItemLabels()).toEqual(["Start Charm"]);
    });

    fireEvent.change(search, { target: { value: "missing-action" } });
    expect(await screen.findByText("No matching items")).toBeVisible();
  });

  it("lets frecency promote a create action without changing its source", async () => {
    useCommandPaletteMru.setState({
      entries: [
        {
          actionId: "pier.run.task",
          lastUsedAt: Date.now(),
          useCount: 10,
        },
      ],
      frecencyMap: new Map([["pier.run.task", 10]]),
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    await screen.findByText("Create in this panel group", {
      selector: "[data-slot='popover-title']",
    });
    expect(visibleCommandItemLabels()[0]).toBe("Run Task…");
  });

  it("blocks global keybindings and preserves IME Escape", async () => {
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const search = screen.getByPlaceholderText("Search panel types or agents…");
    fireEvent.change(search, { target: { value: "cod" } });
    expect(useKeybindingScope.getState().overlayStack).toContain(
      "overlay:add-panel"
    );
    for (const [, eventInit] of IME_KEY_STATES) {
      fireEvent.keyDown(search, {
        code: "Escape",
        key: "Escape",
        ...eventInit,
      });
      expect(
        document.querySelector("[data-slot='popover-content']")
      ).not.toBeNull();
      expect(search).toHaveValue("cod");
    }

    fireEvent.keyDown(search, { code: "Escape", key: "Escape" });
    await waitFor(() => {
      expect(
        document.querySelector("[data-slot='popover-content']")
      ).toBeNull();
    });
    expect(useKeybindingScope.getState().overlayStack).not.toContain(
      "overlay:add-panel"
    );
    openAddPanelPopover();
    expect(
      screen.getByPlaceholderText("Search panel types or agents…")
    ).toHaveValue("");
  });

  it("creates direct panels in the group whose add button was used", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    const originalGroup = props.group;
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);

    openAddPanelPopover();
    Object.defineProperty(props.containerApi, "activeGroup", {
      configurable: true,
      value: { activePanel: null, id: "other-group", panels: [] },
    });
    fireEvent.click(await findCommandItem("New Terminal"));

    expect(props.containerApi.addPanel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        component: "terminal",
        id: "terminal-123",
        position: {
          direction: "within",
          referenceGroup: originalGroup,
        },
      })
    );

    openAddPanelPopover();
    fireEvent.click(await findCommandItem("New Mission Control"));
    expect(props.containerApi.addPanel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        component: "mission-control",
        position: {
          direction: "within",
          referenceGroup: originalGroup,
        },
      })
    );
  });

  it("opens the existing task quick pick from the creator", async () => {
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();
    await act(async () => {
      fireEvent.click(await findCommandItem("Run Task…"));
    });

    expect(panel.api.setActive).toHaveBeenCalledTimes(2);
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
    expect(document.querySelector("[data-slot='popover-content']")).toBeNull();
  });

  it("keeps disabled create actions visible with their reason", async () => {
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "worktree",
      disabledReason: () => "Open a Git project first",
      enabled: () => false,
      handler,
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree", sortOrder: 2 },
      surfaces: ["command-palette", "create-menu"],
      title: () => "Create Worktree",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const item = await findCommandItem("Create Worktree");
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("Open a Git project first");
    fireEvent.click(item);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refreshes contextual action state when the active panel context changes", async () => {
    const handler = vi.fn();
    const isGitContext = () =>
      Boolean(
        usePanelDescriptorStore.getState().descriptors["terminal-1"]?.context
          ?.gitRoot
      );
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "worktree",
      disabledReason: () =>
        isGitContext() ? null : "Open a Git project first",
      enabled: isGitContext,
      handler,
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree", sortOrder: 2 },
      surfaces: ["command-palette", "create-menu"],
      title: () => "Create Worktree",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: {
        contextId: "ctx-1",
        cwd: "/repo",
        openedPath: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeKey: "/repo",
      },
      display: { short: "repo" },
    });

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const item = await findCommandItem("Create Worktree");
    expect(item).toHaveAttribute("aria-disabled", "true");

    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: {
        contextId: "ctx-1",
        cwd: "/repo",
        gitRoot: "/repo",
        openedPath: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 2,
        worktreeKey: "/repo",
      },
      display: { short: "repo" },
    });

    await waitFor(() => {
      expect(item).not.toHaveAttribute("aria-disabled", "true");
    });
    fireEvent.click(item);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("activates the clicked panel before evaluating contextual actions", async () => {
    const panel = createPanel("terminal-1", "Terminal 1");
    const enabled = vi.fn(() => panel.api.setActive.mock.calls.length > 0);
    const handler = vi.fn();
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      enabled,
      handler,
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree", sortOrder: 2 },
      surfaces: ["command-palette", "create-menu"],
      title: () => "Create Worktree",
    });
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    const item = await findCommandItem("Create Worktree");
    expect(item).not.toHaveAttribute("aria-disabled", "true");
    panel.api.setActive.mockClear();
    enabled.mockClear();
    fireEvent.click(item);
    await waitFor(() => {
      expect(handler).toHaveBeenCalledOnce();
    });
    expect(panel.api.setActive).toHaveBeenCalledOnce();
    const activationOrder = panel.api.setActive.mock.invocationCallOrder[0];
    const enabledOrder = enabled.mock.invocationCallOrder[0];
    const handlerOrder = handler.mock.invocationCallOrder[0];
    if (!(activationOrder && enabledOrder && handlerOrder)) {
      throw new Error("Expected activation, enablement, and handler calls");
    }
    expect(activationOrder).toBeLessThan(enabledOrder);
    expect(enabledOrder).toBeLessThan(handlerOrder);
  });

  it("localizes plugin categories from their metadata key", async () => {
    await i18next.changeLanguage("zh-CN");
    disposeWorktreeCreateAction = actionRegistry.register({
      category: "Worktree",
      handler: vi.fn(),
      id: "pier.worktree.create",
      metadata: { categoryKey: "worktree", sortOrder: 2 },
      surfaces: ["command-palette", "create-menu"],
      title: () => "创建工作树",
    });
    const props = createProps([createPanel("terminal-1", "终端 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "在此面板组中新建" }));

    expect(
      await screen.findByText("工作树", { selector: "[cmdk-group-heading]" })
    ).toBeVisible();
  });

  it("passes the clicked group to arbitrary create-menu actions", async () => {
    const handler = vi.fn();
    const dispose = actionRegistry.register({
      category: "run",
      handler,
      id: "test.create",
      metadata: { categoryKey: "run", sortOrder: 999 },
      surfaces: ["create-menu"],
      title: () => "Test Create",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    const sourceContext = {
      contextId: "ctx-source",
      cwd: "/repo",
      gitRoot: "/repo",
      openedPath: "/repo",
      projectRootPath: "/repo",
      source: "panel" as const,
      updatedAt: 1,
      worktreeKey: "/repo",
    };
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: sourceContext,
      display: { short: "repo" },
    });

    try {
      render(<WorkspaceHeaderActions {...props} />);
      openAddPanelPopover();
      fireEvent.click(await findCommandItem("Test Create"));

      await waitFor(() => {
        expect(handler).toHaveBeenCalledWith({
          sourcePanelContext: sourceContext,
          sourcePanelGroupId: "group-1",
          sourcePanelId: "terminal-1",
        });
      });
    } finally {
      dispose();
    }
  });

  it("reports an unhandled create action failure to the user", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = actionRegistry.register({
      category: "run",
      handler: vi.fn().mockRejectedValue(new Error("action boom")),
      id: "test.create.failure",
      metadata: { categoryKey: "run", sortOrder: 999 },
      surfaces: ["create-menu"],
      title: () => "Failing Create",
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    try {
      render(<WorkspaceHeaderActions {...props} />);
      openAddPanelPopover();
      fireEvent.click(await findCommandItem("Failing Create"));

      await waitFor(() => {
        expect(useAppDialogStore.getState().current).toMatchObject({
          body: "action boom",
          kind: "alert",
          title: "Couldn’t complete action",
        });
      });
    } finally {
      dispose();
    }
  });

  it("launches a selected agent in the clicked group", async () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    const deferred = Promise.withResolvers<{ launchId: string | null }>();
    prepareAgentLaunch.mockReturnValueOnce(deferred.promise);
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
      isDetecting: false,
      isRefreshing: false,
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    const originalGroup = props.group;
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();
    fireEvent.click(await findCommandItem("Start Claude"));
    await waitFor(() => {
      expect(prepareAgentLaunch).toHaveBeenCalledWith("claude");
    });

    Object.defineProperty(props.containerApi, "activeGroup", {
      configurable: true,
      value: { activePanel: null, id: "other-group", panels: [] },
    });
    await act(async () => {
      deferred.resolve({ launchId: "launch-agent" });
      await deferred.promise;
    });

    await waitFor(() => {
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

  it("adds detected agents to an already-open creator", async () => {
    const deferred = Promise.withResolvers<{ detectedIds: AgentKind[] }>();
    detectAgents.mockReturnValueOnce(deferred.promise);
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();
    expect(screen.queryByText("Start Claude")).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve({ detectedIds: ["claude"] });
      await deferred.promise;
    });

    expect(await findCommandItem("Start Claude")).toBeVisible();
  });

  it("reports background detection failure without hiding other actions", async () => {
    detectAgents.mockRejectedValueOnce(new Error("detect boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    openAddPanelPopover();

    await waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "detect boom",
        kind: "alert",
        title: "Couldn’t detect agents",
      });
    });
    expect(await findCommandItem("New Terminal")).toBeVisible();
    expect(
      document.querySelector("[data-slot='popover-content']")
    ).not.toBeNull();

    resetAppDialogForTests();
  });

  it("ignores a background detection failure after the creator closes", async () => {
    const deferred = Promise.withResolvers<{ detectedIds: AgentKind[] }>();
    detectAgents.mockReturnValueOnce(deferred.promise);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    const props = createProps([createPanel("terminal-1", "Terminal 1")]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);

    render(<WorkspaceHeaderActions {...props} />);
    const trigger = openAddPanelPopover();
    await waitFor(() => {
      expect(detectAgents).toHaveBeenCalledOnce();
    });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(
        document.querySelector("[data-slot='popover-content']")
      ).toBeNull();
    });

    await act(async () => {
      deferred.reject(new Error("late detect boom"));
      await Promise.allSettled([deferred.promise]);
    });

    expect(useAppDialogStore.getState().current).toBeNull();
  });
});
