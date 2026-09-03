import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  cleanup,
  fireEvent,
  type RenderOptions,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import i18next from "i18next";
import type { ReactElement } from "react";
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
import { AddPanelAction } from "@/components/workspace/add-panel-action.tsx";
import { initI18n } from "@/i18n/index.ts";
import { registerAgentStartActions } from "@/lib/actions/agent-start-actions.ts";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function render(ui: ReactElement, options?: RenderOptions) {
  return renderBase(<TooltipProvider>{ui}</TooltipProvider>, options);
}

let disposeAgentStartActions: (() => void) | null = null;
let disposePanelActions: (() => void) | null = null;
let disposeRunActions: (() => void) | null = null;
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

interface TestPanel {
  api: {
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
      setActive: vi.fn(),
    },
    id,
    title,
    view: {
      contentComponent: "terminal",
    },
  };
}

const DEFAULT_TEST_PANEL_CONTEXT = {
  contextId: "ctx-test",
  cwd: "/repo",
  gitRoot: "/repo",
  openedPath: "/repo",
  projectRootPath: "/repo",
  source: "panel" as const,
  updatedAt: 1,
  worktreeKey: "/repo",
};

function seedPanelProjectContext(panelId: string): void {
  usePanelDescriptorStore.getState().upsert(panelId, {
    context: DEFAULT_TEST_PANEL_CONTEXT,
    display: { short: panelId },
  });
}

function createProps(panels: TestPanel[]): IDockviewHeaderActionsProps {
  const activePanel = panels[0] ?? null;
  const group = {
    activePanel,
    id: "group-1",
    panels,
  };
  const containerApi = {
    activeGroup: group,
    activePanel,
    addPanel: vi.fn(),
    groups: [group],
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
  const trigger = screen.getByRole("button", { name: "New" });
  fireEvent.click(trigger);
  return trigger;
}

function visibleCommandItemLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]")).map(
    (item) => {
      const label = item.querySelector(":scope > span.min-w-0.flex-1");
      return label?.textContent ?? "";
    }
  );
}

function seedAgents(
  detectedIds: AgentKind[],
  defaultAgentId: AgentKind | null = null
): void {
  useAgentDetectStore.setState({
    detectedIds,
    hasDetected: true,
    isDetecting: false,
    isRefreshing: false,
  });
  useAgentPreferencesStore.setState({
    defaultAgentId,
    disabledAgentIds: [],
  });
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  keybindingRegistry.loadUserKeymap([]);
  originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
  originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
  originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
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
  disposePanelActions = registerPanelActions();
  disposeRunActions = registerRunActions();
  disposeAgentStartActions = registerAgentStartActions();
  useSettingsDialogStore.setState({
    activeSection: "appearance",
    isOpen: false,
  });
});

afterEach(() => {
  cleanup();
  disposeAgentStartActions?.();
  disposeAgentStartActions = null;
  disposeRunActions?.();
  disposeRunActions = null;
  disposePanelActions?.();
  disposePanelActions = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useWorkspaceStore.getState().setApi(null);
  usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
  useAgentDetectStore.setState({
    detectedIds: [],
    hasDetected: false,
    isDetecting: false,
    isRefreshing: false,
    ensureDetected: defaultEnsureDetected,
  });
  useAgentPreferencesStore.setState({
    defaultAgentId: null,
    disabledAgentIds: [],
  });
  useSettingsDialogStore.setState({
    activeSection: "appearance",
    isOpen: false,
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
});

describe("create menu preference", () => {
  it("keeps New Terminal first and Manage Agents outside cmdk", async () => {
    seedAgents(["claude", "codex"], "codex");
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    seedPanelProjectContext("terminal-1");

    render(<AddPanelAction {...props} />);
    const trigger = openAddPanelPopover();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await screen.findByText("Create in this panel group", {
      selector: "[data-slot='popover-title']",
    });
    expect(visibleCommandItemLabels()[0]).toBe("New Terminal");

    const manage = screen.getByRole("button", { name: "Manage Agents…" });
    expect(manage.closest("[cmdk-item]")).toBeNull();
    expect(manage.parentElement?.className).toContain("border-t");
    expect(manage.parentElement?.className).not.toMatch(/\bmx-/);
  });

  it("opens agents settings after closing the popover", async () => {
    seedAgents([]);
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    seedPanelProjectContext("terminal-1");

    render(<AddPanelAction {...props} />);
    const trigger = openAddPanelPopover();
    fireEvent.click(screen.getByRole("button", { name: "Manage Agents…" }));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(useSettingsDialogStore.getState().activeSection).toBe("agents");
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
  });

  it("keeps Manage Agents visible while searching", async () => {
    seedAgents(["claude"]);
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    seedPanelProjectContext("terminal-1");

    render(<AddPanelAction {...props} />);
    openAddPanelPopover();
    const search = screen.getByPlaceholderText("Search panel types or agents…");
    fireEvent.change(search, { target: { value: "missing-action" } });
    expect(await screen.findByText("No matching items")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Manage Agents…" })
    ).toBeInTheDocument();
  });

  it("marks the default agent without changing catalog order", async () => {
    seedAgents(["claude", "codex"], "codex");
    const panel = createPanel("terminal-1", "Terminal 1");
    const props = createProps([panel]);
    useWorkspaceStore.getState().setApi(props.containerApi as never);
    seedPanelProjectContext("terminal-1");

    render(<AddPanelAction {...props} />);
    openAddPanelPopover();

    await waitFor(() => {
      expect(visibleCommandItemLabels()).toEqual(
        expect.arrayContaining(["Start Claude", "Start Codex"])
      );
    });
    const labels = visibleCommandItemLabels();
    expect(labels.indexOf("Start Claude")).toBeLessThan(
      labels.indexOf("Start Codex")
    );

    const claude = screen.getByText("Start Claude").closest("[cmdk-item]");
    const codex = screen.getByText("Start Codex").closest("[cmdk-item]");
    expect(claude).toBeTruthy();
    expect(codex).toBeTruthy();
    expect(codex?.textContent).toContain("Default");
    expect(claude?.textContent).not.toContain("Default");
  });
});
