import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

describe("workspace terminal close lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        closeCurrentWindow: vi.fn(async () => undefined),
        getWindowContext: vi.fn(async () => ({
          mode: "restore",
          recordId: "record-current",
          sessionId: "record-current",
          windowId: "main",
        })),
        workspace: { clearLayout: vi.fn(async () => undefined) },
        terminal: { close: vi.fn() },
      },
    });
    useWorkspaceStore.getState().setApi(null);
  });

  it("closes the native terminal when a terminal panel is explicitly closed", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel, { ...terminalPanel("terminal-2"), id: "welcome-1" }],
      removePanel: vi.fn(),
      totalPanels: 2,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });

  it("Cmd+W closes the active terminal panel when more than one panel exists", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel, { ...terminalPanel("terminal-2"), id: "terminal-2" }],
      removePanel: vi.fn(),
      totalPanels: 2,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
    expect(window.pier.closeCurrentWindow).not.toHaveBeenCalled();
  });

  it("Cmd+W closes the current window instead of removing the last panel", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closeActivePanel();

    expect(window.pier.closeCurrentWindow).toHaveBeenCalled();
    expect(window.pier.terminal.close).not.toHaveBeenCalled();
    expect(api.removePanel).not.toHaveBeenCalled();
  });

  it("clears closeAll layout from the current window record", async () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().closeAll();

    expect(window.pier.getWindowContext).toHaveBeenCalled();
    expect(window.pier.workspace.clearLayout).toHaveBeenCalledWith(
      "record-current"
    );
  });

  it("clears resetLayout from the current window record", async () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      addPanel: vi.fn(),
      panels: [panel],
      removePanel: vi.fn(),
      totalPanels: 1,
    };

    useWorkspaceStore.getState().setApi(api as never);

    await useWorkspaceStore.getState().resetLayout();

    expect(window.pier.getWindowContext).toHaveBeenCalled();
    expect(window.pier.workspace.clearLayout).toHaveBeenCalledWith(
      "record-current"
    );
  });
});
