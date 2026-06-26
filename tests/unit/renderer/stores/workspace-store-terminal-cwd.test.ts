import type { PanelContext } from "@shared/contracts/panel.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

function terminalPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function createApi() {
  const panel = terminalPanel("terminal-1");
  return {
    activeGroup: { id: "group-1" },
    activePanel: panel,
    addPanel: vi.fn(),
    panels: [panel],
    removePanel: vi.fn(),
    totalPanels: 1,
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

describe("workspace.store — terminal context policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {},
    });
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
  });

  it("explicit context is persisted as the only terminal panel params", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({ context });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: { context },
        title: "Terminal: /Users/xyz/ABC/pier",
      })
    );
  });

  it("inherits context from the current active terminal", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().setActive("terminal-1");
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context,
      display: { short: "pier" },
    });

    useWorkspaceStore.getState().addTerminal();

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { context },
      })
    );
  });

  it("shellDefault policy creates a terminal without context params", () => {
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "shellDefault",
    });
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().setActive("terminal-1");
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context,
      display: { short: "pier" },
    });

    useWorkspaceStore.getState().addTerminal();

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.not.objectContaining({
        params: expect.anything(),
      })
    );
  });

  it("split terminal inherits the source terminal context", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context,
      display: { short: "pier" },
    });

    useWorkspaceStore.getState().splitPanel("terminal-1", "right");

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: { context },
        position: {
          direction: "right",
          referencePanel: "terminal-1",
        },
      })
    );
  });
});
