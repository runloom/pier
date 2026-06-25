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

describe("workspace.store — terminal cwd policy", () => {
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

  it("显式 path 创建终端时作为 cwd 传入 panel params", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().addTerminal({ path: "/Users/xyz/ABC/pier" });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: { cwd: "/Users/xyz/ABC/pier" },
        title: "Terminal: /Users/xyz/ABC/pier",
      })
    );
  });

  it("默认从当前 active terminal 继承 cwd", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().setActive("terminal-1");
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      short: "pier",
      path: "/Users/xyz/ABC/pier",
    });

    useWorkspaceStore.getState().addTerminal();

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { cwd: "/Users/xyz/ABC/pier" },
      })
    );
  });

  it("shellDefault 策略下普通新建终端不传 cwd", () => {
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "shellDefault",
    });
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().setActive("terminal-1");
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      short: "pier",
      path: "/Users/xyz/ABC/pier",
    });

    useWorkspaceStore.getState().addTerminal();

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.not.objectContaining({
        params: expect.anything(),
      })
    );
  });

  it("拆分终端时继承来源终端 cwd", () => {
    const api = createApi();
    useWorkspaceStore.getState().setApi(api as never);
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      short: "pier",
      path: "/Users/xyz/ABC/pier",
    });

    useWorkspaceStore.getState().splitPanel("terminal-1", "right");

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        params: { cwd: "/Users/xyz/ABC/pier" },
        position: {
          direction: "right",
          referencePanel: "terminal-1",
        },
      })
    );
  });
});
